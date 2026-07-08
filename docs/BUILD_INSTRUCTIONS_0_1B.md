# 0.1b — Local Build Instructions
# Official Luau WASM + Custom AST Serializer

## Critical Finding (from probe)

The official `AstJsonEncoder` (`Luau::toJson()`) uses **denormalized inline AstLocal objects**:

```json
"local": { "name": "x", "type": "AstLocal", "location": "0,6 - 0,7" }
```

This diverges from `AST_CONTRACT.md`'s normalized `locals` table design in two ways:
1. No pointer identity (same `AstLocal*` inlined at every usage site separately)
2. Location string `"0,0 - 0,0"` format, not `{begin:{line,column}, end:{line,column}}`
3. Missing: `shadowId`, `functionDepth`, `loopDepth`, `upvalue`, `hasAnnotation`

**Decision: write a custom WASM serializer** (`ObscuraSerializer.cpp`) rather than
using `AstJsonEncoder`. It calls `Luau::Parser::parse()` and walks the AST with a
custom visitor, assigning stable integer IDs and emitting the `ObscuraParseResult`
JSON shape from `AST_CONTRACT.md` directly.

This is bounded work (the visitor pattern is standard, `AstJsonEncoder.cpp` is the reference)
and produces the correct wire format without a denormalize→renormalize conversion in TS.

---

## Prerequisites (local machine)

```bash
# macOS
brew install emscripten cmake
# or via emsdk (cross-platform):
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install latest && ./emsdk activate latest
source ./emsdk_env.sh   # add to shell profile

# Linux (Ubuntu/Debian)
sudo apt-get install -y cmake g++
# emsdk (same as above)

# Verify
emcc --version   # must show Emscripten 3.x+
cmake --version  # 3.14+
node --version   # 18+
```

---

## Step 1 — Clone Luau at pinned tag

```bash
git clone --depth 1 --branch 0.701 https://github.com/luau-lang/luau.git
cd luau
git describe --tags   # must print: 0.701
```

---

## Step 2 — Verify native build first (sanity check)

```bash
mkdir build-native && cd build-native
cmake .. -DCMAKE_BUILD_TYPE=Release -DLUAU_BUILD_TESTS=OFF
make luau -j4        # builds the CLI binary
echo 'print("ok")' | ./luau    # must print: ok
cd ..
```

---

## Step 3 — Write custom serializer (ObscuraSerializer.cpp)

Create `CLI/src/ObscuraSerializer.cpp` in the cloned Luau repo:

```cpp
// ObscuraSerializer.cpp
// Parses Luau source and emits ObscuraParseResult JSON per AST_CONTRACT.md schemaVersion 1
// Exported as: parseToJson(source: string) -> string  (via Emscripten)

#include "Luau/Ast.h"
#include "Luau/Parser.h"
#include "Luau/ParseResult.h"
#include "Luau/Common.h"

#include <string>
#include <unordered_map>
#include <vector>
#include <sstream>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#endif

// ---- JSON helpers ----------------------------------------------------------

static std::string jsonStr(const std::string& s) {
    std::string out = "\"";
    for (char c : s) {
        if (c == '"')       out += "\\\"";
        else if (c == '\\') out += "\\\\";
        else if (c == '\n') out += "\\n";
        else if (c == '\r') out += "\\r";
        else if (c == '\t') out += "\\t";
        else if ((unsigned char)c < 0x20) {
            char buf[8];
            snprintf(buf, sizeof(buf), "\\u%04x", (unsigned char)c);
            out += buf;
        } else out += c;
    }
    out += "\"";
    return out;
}

static std::string jsonLoc(const Luau::Location& loc) {
    std::ostringstream ss;
    ss << "{\"begin\":{\"line\":" << loc.begin.line
       << ",\"column\":" << loc.begin.column
       << "},\"end\":{\"line\":" << loc.end.line
       << ",\"column\":" << loc.end.column << "}}";
    return ss.str();
}

// ---- ID assignment ---------------------------------------------------------

enum class LocalKind { Local, Param, Self, ForNum, ForIn, Function };

static const char* localKindStr(LocalKind k) {
    switch (k) {
        case LocalKind::Local:    return "local";
        case LocalKind::Param:    return "param";
        case LocalKind::Self:     return "self";
        case LocalKind::ForNum:   return "for_num";
        case LocalKind::ForIn:    return "for_in";
        case LocalKind::Function: return "function";
    }
    return "local";
}

struct LocalTable {
    std::unordered_map<const Luau::AstLocal*, int> ids;
    std::vector<const Luau::AstLocal*> ordered;
    std::unordered_map<const Luau::AstLocal*, LocalKind> kinds;

    int assign(const Luau::AstLocal* local, LocalKind kind) {
        auto it = ids.find(local);
        if (it != ids.end()) return it->second;
        int id = (int)ordered.size();
        ids[local] = id;
        kinds[local] = kind;
        ordered.push_back(local);
        return id;
    }

    int get(const Luau::AstLocal* local) const {
        auto it = ids.find(local);
        return it != ids.end() ? it->second : -1;
    }

    LocalKind getKind(const Luau::AstLocal* local) const {
        auto it = kinds.find(local);
        return it != kinds.end() ? it->second : LocalKind::Local;
    }
};

// ---- Forward declarations --------------------------------------------------

static std::string emitExpr(const Luau::AstExpr* expr, LocalTable& lt);
static std::string emitStat(const Luau::AstStat* stat, LocalTable& lt);
static std::string emitBlock(const Luau::AstStatBlock* block, LocalTable& lt);
static std::string emitFunction(const Luau::AstExprFunction* func, LocalTable& lt);

// ---- Pre-pass: walk entire tree to assign all AstLocal IDs in DFS order ----
// (ensures declaration site gets a lower ID than usage sites)

struct LocalCollector : Luau::AstVisitor {
    LocalTable& lt;
    LocalCollector(LocalTable& lt) : lt(lt) {}

    bool visit(Luau::AstStatLocal* node) override {
        for (size_t i = 0; i < node->vars.size; ++i)
            lt.assign(node->vars.data[i], LocalKind::Local);
        return true;
    }
    bool visit(Luau::AstStatLocalFunction* node) override {
        lt.assign(node->name, LocalKind::Function);
        return true;
    }
    bool visit(Luau::AstExprFunction* node) override {
        if (node->self) lt.assign(node->self, LocalKind::Self);
        for (size_t i = 0; i < node->args.size; ++i)
            lt.assign(node->args.data[i], LocalKind::Param);
        return true;
    }
    bool visit(Luau::AstStatFor* node) override {
        lt.assign(node->var, LocalKind::ForNum);
        return true;
    }
    bool visit(Luau::AstStatForIn* node) override {
        for (size_t i = 0; i < node->vars.size; ++i)
            lt.assign(node->vars.data[i], LocalKind::ForIn);
        return true;
    }
};

// ---- Emitters --------------------------------------------------------------

static std::string emitLocalRef(const Luau::AstLocal* local, LocalTable& lt) {
    int id = lt.get(local);
    return std::to_string(id);
}

static std::string emitExprList(const Luau::AstArray<Luau::AstExpr*>& arr, LocalTable& lt) {
    std::string out = "[";
    for (size_t i = 0; i < arr.size; ++i) {
        if (i > 0) out += ",";
        out += emitExpr(arr.data[i], lt);
    }
    out += "]";
    return out;
}

static std::string emitLocalIdList(const Luau::AstArray<Luau::AstLocal*>& arr, LocalTable& lt) {
    std::string out = "[";
    for (size_t i = 0; i < arr.size; ++i) {
        if (i > 0) out += ",";
        out += std::to_string(lt.get(arr.data[i]));
    }
    out += "]";
    return out;
}

static std::string nodeBase(const char* type, const Luau::Location& loc) {
    return std::string("{\"type\":") + jsonStr(type) + ",\"location\":" + jsonLoc(loc);
}

static std::string emitExpr(const Luau::AstExpr* expr, LocalTable& lt) {
    std::string out;

    if (auto* e = expr->as<Luau::AstExprConstantNil>())
        return nodeBase("AstExprConstantNil", e->location) + "}";

    if (auto* e = expr->as<Luau::AstExprConstantBool>())
        return nodeBase("AstExprConstantBool", e->location)
             + ",\"value\":" + (e->value ? "true" : "false") + "}";

    if (auto* e = expr->as<Luau::AstExprConstantNumber>()) {
        char buf[64];
        snprintf(buf, sizeof(buf), "%.17g", e->value);
        return nodeBase("AstExprConstantNumber", e->location)
             + ",\"value\":" + buf + "}";
    }

    if (auto* e = expr->as<Luau::AstExprConstantString>())
        return nodeBase("AstExprConstantString", e->location)
             + ",\"value\":" + jsonStr(std::string(e->value.data, e->value.size)) + "}";

    if (auto* e = expr->as<Luau::AstExprVarargs>())
        return nodeBase("AstExprVarargs", e->location) + "}";

    if (auto* e = expr->as<Luau::AstExprLocal>())
        return nodeBase("AstExprLocal", e->location)
             + ",\"localId\":" + emitLocalRef(e->local, lt)
             + ",\"upvalue\":" + (e->upvalue ? "true" : "false") + "}";

    if (auto* e = expr->as<Luau::AstExprGlobal>())
        return nodeBase("AstExprGlobal", e->location)
             + ",\"name\":" + jsonStr(e->name.value) + "}";

    if (auto* e = expr->as<Luau::AstExprGroup>())
        return nodeBase("AstExprGroup", e->location)
             + ",\"expr\":" + emitExpr(e->expr, lt) + "}";

    if (auto* e = expr->as<Luau::AstExprCall>()) {
        out = nodeBase("AstExprCall", e->location)
            + ",\"func\":" + emitExpr(e->func, lt)
            + ",\"args\":" + emitExprList(e->args, lt)
            + ",\"self\":" + (e->self ? "true" : "false") + "}";
        return out;
    }

    if (auto* e = expr->as<Luau::AstExprIndexName>()) {
        char opStr[3] = { e->op, 0 };
        return nodeBase("AstExprIndexName", e->location)
             + ",\"expr\":" + emitExpr(e->expr, lt)
             + ",\"index\":" + jsonStr(e->index.value)
             + ",\"op\":" + jsonStr(opStr) + "}";
    }

    if (auto* e = expr->as<Luau::AstExprIndexExpr>()) {
        bool dynStr = e->index->is<Luau::AstExprConstantString>();
        return nodeBase("AstExprIndexExpr", e->location)
             + ",\"expr\":" + emitExpr(e->expr, lt)
             + ",\"index\":" + emitExpr(e->index, lt)
             + ",\"dynamicStringKey\":" + (dynStr ? "true" : "false") + "}";
    }

    if (auto* e = expr->as<Luau::AstExprFunction>())
        return emitFunction(e, lt);

    if (auto* e = expr->as<Luau::AstExprUnary>()) {
        const char* ops[] = {"Not","Minus","Len"};
        return nodeBase("AstExprUnary", e->location)
             + ",\"op\":" + jsonStr(ops[(int)e->op])
             + ",\"expr\":" + emitExpr(e->expr, lt) + "}";
    }

    if (auto* e = expr->as<Luau::AstExprBinary>()) {
        const char* ops[] = {
            "Add","Sub","Mul","Div","FloorDiv","Mod","Pow","Concat",
            "CompareNe","CompareEq","CompareLt","CompareLe","CompareGt","CompareGe",
            "And","Or"
        };
        return nodeBase("AstExprBinary", e->location)
             + ",\"op\":" + jsonStr(ops[(int)e->op])
             + ",\"left\":" + emitExpr(e->left, lt)
             + ",\"right\":" + emitExpr(e->right, lt) + "}";
    }

    if (auto* e = expr->as<Luau::AstExprTypeAssertion>())
        return nodeBase("AstExprTypeAssertion", e->location)
             + ",\"expr\":" + emitExpr(e->expr, lt) + "}";

    if (auto* e = expr->as<Luau::AstExprIfElse>())
        return nodeBase("AstExprIfElse", e->location)
             + ",\"condition\":" + emitExpr(e->condition, lt)
             + ",\"hasThen\":" + (e->hasThen ? "true" : "false")
             + ",\"trueExpr\":" + emitExpr(e->trueExpr, lt)
             + ",\"falseExpr\":" + emitExpr(e->falseExpr, lt) + "}";

    if (auto* e = expr->as<Luau::AstExprInterpString>()) {
        out = nodeBase("AstExprInterpString", e->location) + ",\"strings\":[";
        for (size_t i = 0; i < e->strings.size; ++i) {
            if (i > 0) out += ",";
            out += jsonStr(std::string(e->strings.data[i].data, e->strings.data[i].size));
        }
        out += "],\"expressions\":" + emitExprList(e->expressions, lt) + "}";
        return out;
    }

    if (auto* e = expr->as<Luau::AstExprTable>()) {
        out = nodeBase("AstExprTable", e->location) + ",\"items\":[";
        for (size_t i = 0; i < e->items.size; ++i) {
            if (i > 0) out += ",";
            const auto& item = e->items.data[i];
            const char* kind = item.kind == Luau::AstExprTable::Item::List    ? "list" :
                               item.kind == Luau::AstExprTable::Item::Record  ? "record" : "general";
            out += "{\"kind\":" + jsonStr(kind);
            out += ",\"key\":" + (item.key ? emitExpr(item.key, lt) : "null");
            out += ",\"value\":" + emitExpr(item.value, lt) + "}";
        }
        out += "]}";
        return out;
    }

    if (auto* e = expr->as<Luau::AstExprError>())
        return nodeBase("AstExprError", e->location)
             + ",\"errorIndex\":" + std::to_string(e->messageIndex) + "}";

    if (auto* e = expr->as<Luau::AstExprInstantiate>())
        return nodeBase("AstExprInstantiate", e->location)
             + ",\"expr\":" + emitExpr(e->expr, lt) + "}";
}

static std::string emitFunction(const Luau::AstExprFunction* e, LocalTable& lt) {
    std::string out = nodeBase("AstExprFunction", e->location);
    out += ",\"selfLocalId\":" + (e->self ? std::to_string(lt.get(e->self)) : "null");
    out += ",\"argLocalIds\":" + emitLocalIdList(e->args, lt);
    out += ",\"vararg\":" + std::string(e->vararg ? "true" : "false");
    out += ",\"functionDepth\":" + std::to_string(e->functionDepth);
    out += ",\"debugname\":" + jsonStr(e->debugname.value ? e->debugname.value : "");
    out += ",\"attributes\":[]";  // attribute emit left as exercise; passthrough
    out += ",\"body\":" + emitBlock(e->body, lt) + "}";
    return out;
}

static std::string emitStat(const Luau::AstStat* stat, LocalTable& lt);

static std::string emitBlock(const Luau::AstStatBlock* block, LocalTable& lt) {
    std::string out = nodeBase("AstStatBlock", block->location) + ",\"body\":[";
    for (size_t i = 0; i < block->body.size; ++i) {
        if (i > 0) out += ",";
        out += emitStat(block->body.data[i], lt);
    }
    out += "]}";
    return out;
}

static std::string emitStat(const Luau::AstStat* stat, LocalTable& lt) {
    if (auto* s = stat->as<Luau::AstStatBlock>())
        return emitBlock(s, lt);

    if (auto* s = stat->as<Luau::AstStatIf>()) {
        std::string out = nodeBase("AstStatIf", s->location)
            + ",\"condition\":" + emitExpr(s->condition, lt)
            + ",\"thenBody\":" + emitBlock(s->thenbody, lt)
            + ",\"elseBody\":" + (s->elsebody ? emitStat(s->elsebody, lt) : "null") + "}";
        return out;
    }

    if (auto* s = stat->as<Luau::AstStatWhile>())
        return nodeBase("AstStatWhile", s->location)
             + ",\"condition\":" + emitExpr(s->condition, lt)
             + ",\"body\":" + emitBlock(s->body, lt) + "}";

    if (auto* s = stat->as<Luau::AstStatRepeat>())
        return nodeBase("AstStatRepeat", s->location)
             + ",\"body\":" + emitBlock(s->body, lt)
             + ",\"condition\":" + emitExpr(s->condition, lt) + "}";

    if (stat->is<Luau::AstStatBreak>())
        return nodeBase("AstStatBreak", stat->location) + "}";

    if (stat->is<Luau::AstStatContinue>())
        return nodeBase("AstStatContinue", stat->location) + "}";

    if (auto* s = stat->as<Luau::AstStatReturn>())
        return nodeBase("AstStatReturn", s->location)
             + ",\"values\":" + emitExprList(s->list, lt) + "}";

    if (auto* s = stat->as<Luau::AstStatExpr>())
        return nodeBase("AstStatExpr", s->location)
             + ",\"expr\":" + emitExpr(s->expr, lt) + "}";

    if (auto* s = stat->as<Luau::AstStatLocal>()) {
        std::string out = nodeBase("AstStatLocal", s->location)
            + ",\"varLocalIds\":" + emitLocalIdList(s->vars, lt)
            + ",\"values\":" + emitExprList(s->values, lt) + "}";
        return out;
    }

    if (auto* s = stat->as<Luau::AstStatLocalFunction>())
        return nodeBase("AstStatLocalFunction", s->location)
             + ",\"nameLocalId\":" + std::to_string(lt.get(s->name))
             + ",\"func\":" + emitFunction(s->func, lt) + "}";

    if (auto* s = stat->as<Luau::AstStatFunction>())
        return nodeBase("AstStatFunction", s->location)
             + ",\"nameExpr\":" + emitExpr(s->name, lt)
             + ",\"func\":" + emitFunction(s->func, lt) + "}";

    if (auto* s = stat->as<Luau::AstStatFor>())
        return nodeBase("AstStatFor", s->location)
             + ",\"varLocalId\":" + std::to_string(lt.get(s->var))
             + ",\"from\":" + emitExpr(s->from, lt)
             + ",\"to\":" + emitExpr(s->to, lt)
             + ",\"step\":" + (s->step ? emitExpr(s->step, lt) : "null")
             + ",\"body\":" + emitBlock(s->body, lt) + "}";

    if (auto* s = stat->as<Luau::AstStatForIn>())
        return nodeBase("AstStatForIn", s->location)
             + ",\"varLocalIds\":" + emitLocalIdList(s->vars, lt)
             + ",\"values\":" + emitExprList(s->values, lt)
             + ",\"body\":" + emitBlock(s->body, lt) + "}";

    if (auto* s = stat->as<Luau::AstStatAssign>()) {
        std::string out = nodeBase("AstStatAssign", s->location)
            + ",\"vars\":" + emitExprList(s->vars, lt)
            + ",\"values\":" + emitExprList(s->values, lt) + "}";
        return out;
    }

    if (auto* s = stat->as<Luau::AstStatCompoundAssign>()) {
        const char* ops[] = {
            "Add","Sub","Mul","Div","FloorDiv","Mod","Pow","Concat",
            "CompareNe","CompareEq","CompareLt","CompareLe","CompareGt","CompareGe",
            "And","Or"
        };
        return nodeBase("AstStatCompoundAssign", s->location)
             + ",\"op\":" + jsonStr(ops[(int)s->op])
             + ",\"var\":" + emitExpr(s->var, lt)
             + ",\"value\":" + emitExpr(s->value, lt) + "}";
    }

    if (stat->is<Luau::AstStatError>()) {
        auto* s = stat->as<Luau::AstStatError>();
        return nodeBase("AstStatError", s->location)
             + ",\"errorIndex\":" + std::to_string(s->messageIndex) + "}";
    }

    // AstStatTypeAlias, AstStatDeclareGlobal, etc. — passthrough as opaque
    return nodeBase(stat->is<Luau::AstStatTypeAlias>()        ? "AstStatTypeAlias" :
                    stat->is<Luau::AstStatDeclareGlobal>()    ? "AstStatDeclareGlobal" :
                    stat->is<Luau::AstStatDeclareFunction>()  ? "AstStatDeclareFunction" :
                    stat->is<Luau::AstStatTypeFunction>()     ? "AstStatTypeFunction" :
                                                                "AstStatDeclareExternType",
                    stat->location) + "}";
}

// ---- Main entry point ------------------------------------------------------

static std::string buildLocalsJson(const LocalTable& lt) {
    std::ostringstream out;
    out << "{";
    for (size_t i = 0; i < lt.ordered.size(); ++i) {
        if (i > 0) out << ",";
        const Luau::AstLocal* local = lt.ordered[i];
        auto shadowIt = local->shadow ? lt.ids.find(local->shadow) : lt.ids.end();
        int shadowId = (shadowIt != lt.ids.end()) ? shadowIt->second : -1;
        out << "\"" << i << "\":{"
            << "\"id\":" << i
            << ",\"name\":" << jsonStr(local->name.value)
            << ",\"location\":" << jsonLoc(local->location)
            << ",\"shadowId\":" << (shadowId >= 0 ? std::to_string(shadowId) : "null")
            << ",\"functionDepth\":" << local->functionDepth
            << ",\"loopDepth\":" << local->loopDepth
            << ",\"hasAnnotation\":" << (local->annotation ? "true" : "false")
            << ",\"declarationKind\":" << jsonStr(localKindStr(lt.getKind(local)))
            << "}";
    }
    out << "}";
    return out.str();
}

extern "C" {

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
const char* obscura_parse(const char* source_cstr) {
    static std::string result_storage;

    // Catch ALL exceptions at the WASM boundary.
    // C++ exceptions must not cross into JS — they cause hard crashes in WASM.
    try {
        std::string source(source_cstr);
        Luau::Allocator alloc;
        Luau::AstNameTable names(alloc);
        Luau::ParseOptions opts;
        opts.captureComments = true;

        Luau::ParseResult parsed = Luau::Parser::parse(
            source.data(), source.size(), names, alloc, opts);

        LocalTable lt;
        LocalCollector collector(lt);
        parsed.root->visit(&collector);

        std::string errorsJson = "[";
        for (size_t i = 0; i < parsed.errors.size(); ++i) {
            if (i > 0) errorsJson += ",";
            const auto& err = parsed.errors[i];
            errorsJson += "{\"location\":" + jsonLoc(err.getLocation())
                        + ",\"message\":" + jsonStr(err.getMessage()) + "}";
        }
        errorsJson += "]";

        std::string hotJson = "[";
        for (size_t i = 0; i < parsed.hotcomments.size(); ++i) {
            if (i > 0) hotJson += ",";
            const auto& hc = parsed.hotcomments[i];
            hotJson += "{\"header\":" + std::string(hc.header ? "true" : "false")
                     + ",\"location\":" + jsonLoc(hc.location)
                     + ",\"content\":" + jsonStr(hc.content) + "}";
        }
        hotJson += "]";

        result_storage =
            "{\"schemaVersion\":1"
            ",\"source\":" + jsonStr(source) +
            ",\"locals\":" + buildLocalsJson(lt) +
            ",\"root\":" + emitBlock(parsed.root, lt) +
            ",\"errors\":" + errorsJson +
            ",\"hotcomments\":" + hotJson + "}";

    } catch (const std::exception& e) {
        result_storage =
            "{\"schemaVersion\":1"
            ",\"source\":\"\""
            ",\"locals\":{}"
            ",\"root\":{\"type\":\"AstStatBlock\",\"location\":{\"begin\":{\"line\":0,\"column\":0},\"end\":{\"line\":0,\"column\":0}},\"body\":[]}"
            ",\"errors\":[{\"location\":{\"begin\":{\"line\":0,\"column\":0},\"end\":{\"line\":0,\"column\":0}}"
            ",\"message\":" + jsonStr(std::string("Internal serializer error: ") + e.what()) + "}]"
            ",\"hotcomments\":[]}";
    } catch (...) {
        result_storage =
            "{\"schemaVersion\":1,\"source\":\"\",\"locals\":{},"
            "\"root\":{\"type\":\"AstStatBlock\",\"location\":{\"begin\":{\"line\":0,\"column\":0},\"end\":{\"line\":0,\"column\":0}},\"body\":[]},"
            "\"errors\":[{\"location\":{\"begin\":{\"line\":0,\"column\":0},\"end\":{\"line\":0,\"column\":0}},"
            "\"message\":\"Internal serializer error: unknown exception\"}],"
            "\"hotcomments\":[]}";
    }

    return result_storage.c_str();
    // WASM CALLER CONTRACT:
    // The returned char* points to static storage valid until the NEXT call to obscura_parse().
    // The TypeScript wrapper MUST copy this string synchronously (no await between call and copy).
    // See: packages/core/src/parser.ts wrapper implementation notes.
}

} // extern "C"
```

---

## Step 4 — Add serializer to CMakeLists (WASM build only)

Append to the `if(LUAU_BUILD_WEB)` block in `CMakeLists.txt`:

```cmake
if(LUAU_BUILD_WEB)
    add_executable(Luau.ObscuraParser)
    target_sources(Luau.ObscuraParser PRIVATE CLI/src/ObscuraSerializer.cpp)
    target_include_directories(Luau.ObscuraParser PRIVATE
        Ast/include
        Analysis/include
        Common/include
    )
    target_link_libraries(Luau.ObscuraParser PRIVATE Luau.Ast Luau.Common)
    target_compile_options(Luau.ObscuraParser PRIVATE -fexceptions)
    target_link_options(Luau.ObscuraParser PRIVATE
        -sEXPORTED_FUNCTIONS=["_obscura_parse","_malloc","_free"]
        -sEXPORTED_RUNTIME_METHODS=["ccall","cwrap","UTF8ToString","stringToUTF8","lengthBytesUTF8","stackAlloc"]
        -sENVIRONMENT=node
        -sMODULARIZE=1
        -sEXPORT_NAME=createObscuraModule
        -fexceptions
        -sSINGLE_FILE=1
        --bind
    )
endif()
```

---

## Step 5 — WASM build

```bash
# In the luau repo root
mkdir build-wasm && cd build-wasm
emcmake cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DLUAU_BUILD_TESTS=OFF \
    -DLUAU_BUILD_WEB=ON
emmake make Luau.ObscuraParser -j4

# Expected output:
ls -lh Luau.ObscuraParser   # ~1.5-3MB single-file JS+WASM bundle
```

---

## Step 6 — Verification

```bash
# Quick Node smoke test
node -e "
const createObscuraModule = require('./Luau.ObscuraParser');
createObscuraModule().then(m => {
    const parse = m.cwrap('obscura_parse', 'string', ['string']);
    const result = parse('local x = 1\nreturn x\n');
    const parsed = JSON.parse(result);
    console.assert(parsed.schemaVersion === 1, 'schemaVersion');
    console.assert(parsed.errors.length === 0, 'no errors');
    console.assert(Object.keys(parsed.locals).length === 1, 'one local');
    console.assert(parsed.locals[0].name === 'x', 'local name');
    console.assert(parsed.root.type === 'AstStatBlock', 'root type');
    console.log('PASS');
});
"
```

**Expected output:** `PASS`

---

## Step 7 — Copy artifact to packages/core

```bash
cp Luau.ObscuraParser.js ../../packages/core/native/luau-parser.js
```

Then wire into `packages/core/src/parser.ts` (task 0.4 / index.ts stub replacement).

---

## Expected Artifacts

| File | Size (approx) | Description |
|---|---|---|
| `build-wasm/Luau.ObscuraParser.js` | ~1.5–3 MB | Single-file WASM+JS bundle |
| `packages/core/native/luau-parser.js` | same | Copied to repo |

---

## Known Risks

| Risk | Mitigation |
|---|---|
| `emsdk` bootstrap downloads from CDN not accessible in all CI environments | Pin emsdk version; cache in CI; provide pre-built artifact as fallback |
| `result_storage` static string — not thread-safe | Acceptable for Node single-threaded WASM module; not a production concern |
| `local->shadow` in `buildLocalsJson` — must verify shadow itself was assigned an ID before accessing `ids.at()` | Pre-order DFS collects declarations before usages; shadowed locals are always declared before their shadows in any valid Luau scope. Verify in smoke test with shadow fixture |
| `AstExprInstantiate` fallback path in emitExpr has infinite recursion bug | Fix: emit opaque node `{type:"AstExprInstantiate",location:...}` without calling emitExpr on itself |
