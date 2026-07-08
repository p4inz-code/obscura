// ObscuraSerializer.cpp
// Parses Luau source and emits ObscuraParseResult JSON per AST_CONTRACT.md schemaVersion 1
// Pinned to: luau-lang/luau tag 0.701
//
// Build (native test):
//   g++ -O2 -std=c++17 -I../Ast/include -I../Analysis/include -I../Common/include \
//       ObscuraSerializer.cpp ../build/libLuau.Ast.a ../build/libLuau.Common.a \
//       -DOBSCURA_NATIVE_TEST -o obscura_test
//
// Build (WASM):
//   emcc -O2 -std=c++17 -fexceptions \
//       -I../Ast/include -I../Analysis/include -I../Common/include \
//       ObscuraSerializer.cpp ../build-wasm/libLuau.Ast.a ../build-wasm/libLuau.Common.a \
//       -sEXPORTED_FUNCTIONS='["_obscura_parse","_malloc","_free"]' \
//       -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","lengthBytesUTF8"]' \
//       -sENVIRONMENT=node -sMODULARIZE=1 -sEXPORT_NAME=createObscuraModule \
//       -sSINGLE_FILE=1 -fexceptions \
//       -o luau-parser.js

#include "Luau/Ast.h"
#include "Luau/Parser.h"
#include "Luau/ParseResult.h"

#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>
#include <cstdio>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define OBSCURA_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define OBSCURA_EXPORT
#endif

// ---------------------------------------------------------------------------
// JSON helpers — all use ostringstream, no raw string concatenation
// ---------------------------------------------------------------------------

static void writeJsonStr(std::ostringstream& o, const char* s, size_t len) {
    o << '"';
    for (size_t i = 0; i < len; ++i) {
        unsigned char c = (unsigned char)s[i];
        switch (c) {
            case '"':  o << "\\\""; break;
            case '\\': o << "\\\\"; break;
            case '\n': o << "\\n";  break;
            case '\r': o << "\\r";  break;
            case '\t': o << "\\t";  break;
            case '\0': o << "\\u0000"; break;
            default:
                if (c < 0x20 || c > 0x7e) {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", c);
                    o << buf;
                } else {
                    o << c;
                }
        }
    }
    o << '"';
}

static void writeJsonStr(std::ostringstream& o, const std::string& s) {
    writeJsonStr(o, s.data(), s.size());
}

static void writeJsonStr(std::ostringstream& o, const char* s) {
    if (!s) { o << "\"\""; return; }
    writeJsonStr(o, s, strlen(s));
}

static void writeLoc(std::ostringstream& o, const Luau::Location& loc) {
    o << "{\"begin\":{\"line\":" << loc.begin.line
      << ",\"column\":" << loc.begin.column
      << "},\"end\":{\"line\":" << loc.end.line
      << ",\"column\":" << loc.end.column << "}}";
}

// ---------------------------------------------------------------------------
// Declaration kind
// ---------------------------------------------------------------------------

enum class LocalKind { Local, Param, Self, ForNum, ForIn, Function };

static const char* kindStr(LocalKind k) {
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

// ---------------------------------------------------------------------------
// Local ID table
// ---------------------------------------------------------------------------

struct LocalTable {
    std::unordered_map<const Luau::AstLocal*, int> ids;
    std::unordered_map<const Luau::AstLocal*, LocalKind> kinds;
    std::vector<const Luau::AstLocal*> ordered;

    // First call assigns; subsequent calls return existing id (idempotent)
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

// ---------------------------------------------------------------------------
// Pre-pass: assign all local IDs in pre-order DFS
// Declarations always appear before usage sites in well-formed Luau,
// so DFS guarantees declaration sites get lower IDs than their usages.
// ---------------------------------------------------------------------------

struct LocalCollector : Luau::AstVisitor {
    LocalTable& lt;
    explicit LocalCollector(LocalTable& lt) : lt(lt) {}

    bool visit(Luau::AstStatLocal* node) override {
        for (size_t i = 0; i < node->vars.size; ++i)
            lt.assign(node->vars.data[i], LocalKind::Local);
        return true;
    }
    bool visit(Luau::AstStatLocalFunction* node) override {
        lt.assign(node->name, LocalKind::Function);
        return true; // descend into func body
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

// ---------------------------------------------------------------------------
// Forward declarations
// ---------------------------------------------------------------------------

static void writeExpr(std::ostringstream& o, const Luau::AstExpr* expr, LocalTable& lt);
static void writeStat(std::ostringstream& o, const Luau::AstStat* stat, LocalTable& lt);
static void writeBlock(std::ostringstream& o, const Luau::AstStatBlock* block, LocalTable& lt);
static void writeFunction(std::ostringstream& o, const Luau::AstExprFunction* fn, LocalTable& lt);

// ---------------------------------------------------------------------------
// Helpers for arrays
// ---------------------------------------------------------------------------

static void writeExprArray(std::ostringstream& o,
                           const Luau::AstArray<Luau::AstExpr*>& arr,
                           LocalTable& lt) {
    o << '[';
    for (size_t i = 0; i < arr.size; ++i) {
        if (i > 0) o << ',';
        writeExpr(o, arr.data[i], lt);
    }
    o << ']';
}

static void writeLocalIdArray(std::ostringstream& o,
                              const Luau::AstArray<Luau::AstLocal*>& arr,
                              LocalTable& lt) {
    o << '[';
    for (size_t i = 0; i < arr.size; ++i) {
        if (i > 0) o << ',';
        o << lt.get(arr.data[i]);
    }
    o << ']';
}

static void writeNodeBase(std::ostringstream& o, const char* type,
                          const Luau::Location& loc) {
    o << "{\"type\":";
    writeJsonStr(o, type);
    o << ",\"location\":";
    writeLoc(o, loc);
}

// ---------------------------------------------------------------------------
// Expression serializer
// ---------------------------------------------------------------------------

static void writeExpr(std::ostringstream& o, const Luau::AstExpr* expr, LocalTable& lt) {
    if (auto* e = expr->as<Luau::AstExprConstantNil>()) {
        writeNodeBase(o, "AstExprConstantNil", e->location);
        o << '}';
        return;
    }
    if (auto* e = expr->as<Luau::AstExprConstantBool>()) {
        writeNodeBase(o, "AstExprConstantBool", e->location);
        o << ",\"value\":" << (e->value ? "true" : "false") << '}';
        return;
    }
    if (auto* e = expr->as<Luau::AstExprConstantNumber>()) {
        writeNodeBase(o, "AstExprConstantNumber", e->location);
        char buf[64];
        snprintf(buf, sizeof(buf), "%.17g", e->value);
        o << ",\"value\":" << buf << '}';
        return;
    }
    if (auto* e = expr->as<Luau::AstExprConstantString>()) {
        writeNodeBase(o, "AstExprConstantString", e->location);
        o << ",\"value\":";
        writeJsonStr(o, e->value.data, e->value.size);
        o << '}';
        return;
    }
    if (auto* e = expr->as<Luau::AstExprVarargs>()) {
        writeNodeBase(o, "AstExprVarargs", e->location);
        o << '}';
        return;
    }
    if (auto* e = expr->as<Luau::AstExprLocal>()) {
        writeNodeBase(o, "AstExprLocal", e->location);
        o << ",\"localId\":" << lt.get(e->local)
          << ",\"upvalue\":" << (e->upvalue ? "true" : "false") << '}';
        return;
    }
    if (auto* e = expr->as<Luau::AstExprGlobal>()) {
        writeNodeBase(o, "AstExprGlobal", e->location);
        o << ",\"name\":";
        writeJsonStr(o, e->name.value);
        o << '}';
        return;
    }
    if (auto* e = expr->as<Luau::AstExprGroup>()) {
        writeNodeBase(o, "AstExprGroup", e->location);
        o << ",\"expr\":";
        writeExpr(o, e->expr, lt);
        o << '}';
        return;
    }
    if (auto* e = expr->as<Luau::AstExprCall>()) {
        writeNodeBase(o, "AstExprCall", e->location);
        o << ",\"func\":";
        writeExpr(o, e->func, lt);
        o << ",\"args\":";
        writeExprArray(o, e->args, lt);
        o << ",\"self\":" << (e->self ? "true" : "false") << '}';
        return;
    }
    if (auto* e = expr->as<Luau::AstExprIndexName>()) {
        writeNodeBase(o, "AstExprIndexName", e->location);
        o << ",\"expr\":";
        writeExpr(o, e->expr, lt);
        o << ",\"index\":";
        writeJsonStr(o, e->index.value);
        char op[2] = { e->op, 0 };
        o << ",\"op\":";
        writeJsonStr(o, op);
        o << '}';
        return;
    }
    if (auto* e = expr->as<Luau::AstExprIndexExpr>()) {
        bool dynStr = e->index->is<Luau::AstExprConstantString>();
        writeNodeBase(o, "AstExprIndexExpr", e->location);
        o << ",\"expr\":";
        writeExpr(o, e->expr, lt);
        o << ",\"index\":";
        writeExpr(o, e->index, lt);
        o << ",\"dynamicStringKey\":" << (dynStr ? "true" : "false") << '}';
        return;
    }
    if (auto* e = expr->as<Luau::AstExprFunction>()) {
        writeFunction(o, e, lt);
        return;
    }
    if (auto* e = expr->as<Luau::AstExprUnary>()) {
        static const char* ops[] = {"Not","Minus","Len"};
        writeNodeBase(o, "AstExprUnary", e->location);
        o << ",\"op\":";
        writeJsonStr(o, ops[(int)e->op]);
        o << ",\"expr\":";
        writeExpr(o, e->expr, lt);
        o << '}';
        return;
    }
    if (auto* e = expr->as<Luau::AstExprBinary>()) {
        static const char* ops[] = {
            "Add","Sub","Mul","Div","FloorDiv","Mod","Pow","Concat",
            "CompareNe","CompareEq","CompareLt","CompareLe","CompareGt","CompareGe",
            "And","Or"
        };
        writeNodeBase(o, "AstExprBinary", e->location);
        o << ",\"op\":";
        writeJsonStr(o, ops[(int)e->op]);
        o << ",\"left\":";
        writeExpr(o, e->left, lt);
        o << ",\"right\":";
        writeExpr(o, e->right, lt);
        o << '}';
        return;
    }
    if (auto* e = expr->as<Luau::AstExprTypeAssertion>()) {
        writeNodeBase(o, "AstExprTypeAssertion", e->location);
        o << ",\"expr\":";
        writeExpr(o, e->expr, lt);
        o << '}';
        return;
    }
    if (auto* e = expr->as<Luau::AstExprIfElse>()) {
        writeNodeBase(o, "AstExprIfElse", e->location);
        o << ",\"condition\":";
        writeExpr(o, e->condition, lt);
        o << ",\"hasThen\":" << (e->hasThen ? "true" : "false");
        o << ",\"trueExpr\":";
        writeExpr(o, e->trueExpr, lt);
        o << ",\"falseExpr\":";
        writeExpr(o, e->falseExpr, lt);
        o << '}';
        return;
    }
    if (auto* e = expr->as<Luau::AstExprInterpString>()) {
        writeNodeBase(o, "AstExprInterpString", e->location);
        o << ",\"strings\":[";
        for (size_t i = 0; i < e->strings.size; ++i) {
            if (i > 0) o << ',';
            writeJsonStr(o, e->strings.data[i].data, e->strings.data[i].size);
        }
        o << "],\"expressions\":";
        writeExprArray(o, e->expressions, lt);
        o << '}';
        return;
    }
    if (auto* e = expr->as<Luau::AstExprTable>()) {
        writeNodeBase(o, "AstExprTable", e->location);
        o << ",\"items\":[";
        for (size_t i = 0; i < e->items.size; ++i) {
            if (i > 0) o << ',';
            const auto& item = e->items.data[i];
            const char* kind =
                item.kind == Luau::AstExprTable::Item::List   ? "list" :
                item.kind == Luau::AstExprTable::Item::Record ? "record" : "general";
            o << "{\"kind\":";
            writeJsonStr(o, kind);
            o << ",\"key\":";
            if (item.key) writeExpr(o, item.key, lt); else o << "null";
            o << ",\"value\":";
            writeExpr(o, item.value, lt);
            o << '}';
        }
        o << "]}";
        return;
    }
    if (auto* e = expr->as<Luau::AstExprInstantiate>()) {
        // Generic type instantiation f<<T>>() — emit inner expr, drop type args (passthrough)
        writeNodeBase(o, "AstExprInstantiate", e->location);
        o << ",\"expr\":";
        writeExpr(o, e->expr, lt);
        o << '}';
        return;
    }
    if (auto* e = expr->as<Luau::AstExprError>()) {
        writeNodeBase(o, "AstExprError", e->location);
        o << ",\"errorIndex\":" << e->messageIndex << '}';
        return;
    }
    // Unknown expression node — emit opaque passthrough
    writeNodeBase(o, "AstExprUnknown", expr->location);
    o << '}';
}

// ---------------------------------------------------------------------------
// Function body serializer
// ---------------------------------------------------------------------------

static void writeFunction(std::ostringstream& o,
                          const Luau::AstExprFunction* fn, LocalTable& lt) {
    writeNodeBase(o, "AstExprFunction", fn->location);
    o << ",\"selfLocalId\":";
    if (fn->self) o << lt.get(fn->self); else o << "null";
    o << ",\"argLocalIds\":";
    writeLocalIdArray(o, fn->args, lt);
    o << ",\"vararg\":" << (fn->vararg ? "true" : "false");
    o << ",\"functionDepth\":" << fn->functionDepth;
    o << ",\"debugname\":";
    writeJsonStr(o, fn->debugname.value ? fn->debugname.value : "");
    o << ",\"attributes\":[]";
    o << ",\"body\":";
    writeBlock(o, fn->body, lt);
    o << '}';
}

// ---------------------------------------------------------------------------
// Block serializer
// ---------------------------------------------------------------------------

static void writeBlock(std::ostringstream& o,
                       const Luau::AstStatBlock* block, LocalTable& lt) {
    writeNodeBase(o, "AstStatBlock", block->location);
    o << ",\"body\":[";
    for (size_t i = 0; i < block->body.size; ++i) {
        if (i > 0) o << ',';
        writeStat(o, block->body.data[i], lt);
    }
    o << "]}";
}

// ---------------------------------------------------------------------------
// Statement serializer
// ---------------------------------------------------------------------------

static void writeStat(std::ostringstream& o,
                      const Luau::AstStat* stat, LocalTable& lt) {
    if (auto* s = stat->as<Luau::AstStatBlock>()) {
        writeBlock(o, s, lt);
        return;
    }
    if (auto* s = stat->as<Luau::AstStatIf>()) {
        writeNodeBase(o, "AstStatIf", s->location);
        o << ",\"condition\":";
        writeExpr(o, s->condition, lt);
        o << ",\"thenBody\":";
        writeBlock(o, s->thenbody, lt);
        o << ",\"elseBody\":";
        if (s->elsebody) writeStat(o, s->elsebody, lt); else o << "null";
        o << '}';
        return;
    }
    if (auto* s = stat->as<Luau::AstStatWhile>()) {
        writeNodeBase(o, "AstStatWhile", s->location);
        o << ",\"condition\":";
        writeExpr(o, s->condition, lt);
        o << ",\"body\":";
        writeBlock(o, s->body, lt);
        o << '}';
        return;
    }
    if (auto* s = stat->as<Luau::AstStatRepeat>()) {
        writeNodeBase(o, "AstStatRepeat", s->location);
        o << ",\"body\":";
        writeBlock(o, s->body, lt);
        o << ",\"condition\":";
        writeExpr(o, s->condition, lt);
        o << '}';
        return;
    }
    if (stat->is<Luau::AstStatBreak>()) {
        writeNodeBase(o, "AstStatBreak", stat->location);
        o << '}';
        return;
    }
    if (stat->is<Luau::AstStatContinue>()) {
        writeNodeBase(o, "AstStatContinue", stat->location);
        o << '}';
        return;
    }
    if (auto* s = stat->as<Luau::AstStatReturn>()) {
        writeNodeBase(o, "AstStatReturn", s->location);
        o << ",\"values\":";
        writeExprArray(o, s->list, lt);
        o << '}';
        return;
    }
    if (auto* s = stat->as<Luau::AstStatExpr>()) {
        writeNodeBase(o, "AstStatExpr", s->location);
        o << ",\"expr\":";
        writeExpr(o, s->expr, lt);
        o << '}';
        return;
    }
    if (auto* s = stat->as<Luau::AstStatLocal>()) {
        writeNodeBase(o, "AstStatLocal", s->location);
        o << ",\"varLocalIds\":";
        writeLocalIdArray(o, s->vars, lt);
        o << ",\"values\":";
        writeExprArray(o, s->values, lt);
        o << '}';
        return;
    }
    if (auto* s = stat->as<Luau::AstStatLocalFunction>()) {
        writeNodeBase(o, "AstStatLocalFunction", s->location);
        o << ",\"nameLocalId\":" << lt.get(s->name);
        o << ",\"func\":";
        writeFunction(o, s->func, lt);
        o << '}';
        return;
    }
    if (auto* s = stat->as<Luau::AstStatFunction>()) {
        writeNodeBase(o, "AstStatFunction", s->location);
        o << ",\"nameExpr\":";
        writeExpr(o, s->name, lt);
        o << ",\"func\":";
        writeFunction(o, s->func, lt);
        o << '}';
        return;
    }
    if (auto* s = stat->as<Luau::AstStatFor>()) {
        writeNodeBase(o, "AstStatFor", s->location);
        o << ",\"varLocalId\":" << lt.get(s->var);
        o << ",\"from\":";
        writeExpr(o, s->from, lt);
        o << ",\"to\":";
        writeExpr(o, s->to, lt);
        o << ",\"step\":";
        if (s->step) writeExpr(o, s->step, lt); else o << "null";
        o << ",\"body\":";
        writeBlock(o, s->body, lt);
        o << '}';
        return;
    }
    if (auto* s = stat->as<Luau::AstStatForIn>()) {
        writeNodeBase(o, "AstStatForIn", s->location);
        o << ",\"varLocalIds\":";
        writeLocalIdArray(o, s->vars, lt);
        o << ",\"values\":";
        writeExprArray(o, s->values, lt);
        o << ",\"body\":";
        writeBlock(o, s->body, lt);
        o << '}';
        return;
    }
    if (auto* s = stat->as<Luau::AstStatAssign>()) {
        writeNodeBase(o, "AstStatAssign", s->location);
        o << ",\"vars\":";
        writeExprArray(o, s->vars, lt);
        o << ",\"values\":";
        writeExprArray(o, s->values, lt);
        o << '}';
        return;
    }
    if (auto* s = stat->as<Luau::AstStatCompoundAssign>()) {
        static const char* ops[] = {
            "Add","Sub","Mul","Div","FloorDiv","Mod","Pow","Concat",
            "CompareNe","CompareEq","CompareLt","CompareLe","CompareGt","CompareGe",
            "And","Or"
        };
        writeNodeBase(o, "AstStatCompoundAssign", s->location);
        o << ",\"op\":";
        writeJsonStr(o, ops[(int)s->op]);
        o << ",\"var\":";
        writeExpr(o, s->var, lt);
        o << ",\"value\":";
        writeExpr(o, s->value, lt);
        o << '}';
        return;
    }
    if (auto* s = stat->as<Luau::AstStatError>()) {
        writeNodeBase(o, "AstStatError", s->location);
        o << ",\"errorIndex\":" << s->messageIndex << '}';
        return;
    }
    // Type-system statements: AstStatTypeAlias, AstStatDeclareGlobal,
    // AstStatDeclareFunction, AstStatTypeFunction, AstStatDeclareExternType
    // Emit as opaque passthrough nodes (location only) — not walked by transforms
    const char* opaqueType =
        stat->is<Luau::AstStatTypeAlias>()         ? "AstStatTypeAlias" :
        stat->is<Luau::AstStatDeclareGlobal>()     ? "AstStatDeclareGlobal" :
        stat->is<Luau::AstStatDeclareFunction>()   ? "AstStatDeclareFunction" :
        stat->is<Luau::AstStatTypeFunction>()      ? "AstStatTypeFunction" :
                                                     "AstStatDeclareExternType";
    writeNodeBase(o, opaqueType, stat->location);
    o << '}';
}

// ---------------------------------------------------------------------------
// Locals table serializer
// ---------------------------------------------------------------------------

static void writeLocalsTable(std::ostringstream& o, const LocalTable& lt) {
    o << '{';
    for (size_t i = 0; i < lt.ordered.size(); ++i) {
        if (i > 0) o << ',';
        const Luau::AstLocal* local = lt.ordered[i];
        auto shadowIt = local->shadow ? lt.ids.find(local->shadow) : lt.ids.end();
        int shadowId = (shadowIt != lt.ids.end()) ? shadowIt->second : -1;

        o << '"' << i << "\":{";
        o << "\"id\":" << i;
        o << ",\"name\":";
        writeJsonStr(o, local->name.value);
        o << ",\"location\":";
        writeLoc(o, local->location);
        o << ",\"shadowId\":";
        if (shadowId >= 0) o << shadowId; else o << "null";
        o << ",\"functionDepth\":" << local->functionDepth;
        o << ",\"loopDepth\":" << local->loopDepth;
        o << ",\"hasAnnotation\":" << (local->annotation ? "true" : "false");
        o << ",\"declarationKind\":";
        writeJsonStr(o, kindStr(lt.getKind(local)));
        o << '}';
    }
    o << '}';
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

static std::string g_result; // stable across the WASM boundary until next call

static void buildResult(std::ostringstream& o,
                        const std::string& source,
                        const LocalTable& lt,
                        const Luau::AstStatBlock* root,
                        const std::vector<Luau::ParseError>& errors,
                        const std::vector<Luau::HotComment>& hotcomments) {
    o << "{\"schemaVersion\":1";

    o << ",\"source\":";
    writeJsonStr(o, source);

    o << ",\"locals\":";
    writeLocalsTable(o, lt);

    o << ",\"root\":";
    // Cast to non-const for LocalTable& parameter (LocalTable is read-only here)
    LocalTable& ltRef = const_cast<LocalTable&>(lt);
    writeBlock(o, root, ltRef);

    o << ",\"errors\":[";
    for (size_t i = 0; i < errors.size(); ++i) {
        if (i > 0) o << ',';
        o << "{\"location\":";
        writeLoc(o, errors[i].getLocation());
        o << ",\"message\":";
        writeJsonStr(o, errors[i].getMessage());
        o << '}';
    }
    o << ']';

    o << ",\"hotcomments\":[";
    for (size_t i = 0; i < hotcomments.size(); ++i) {
        if (i > 0) o << ',';
        const auto& hc = hotcomments[i];
        o << "{\"header\":" << (hc.header ? "true" : "false");
        o << ",\"location\":";
        writeLoc(o, hc.location);
        o << ",\"content\":";
        writeJsonStr(o, hc.content);
        o << '}';
    }
    o << "]}";
}

static const char* buildError(const std::string& message) {
    std::ostringstream o;
    o << "{\"schemaVersion\":1"
         ",\"source\":\"\""
         ",\"locals\":{}"
         ",\"root\":{\"type\":\"AstStatBlock\""
         ",\"location\":{\"begin\":{\"line\":0,\"column\":0}"
         ",\"end\":{\"line\":0,\"column\":0}}"
         ",\"body\":[]}"
         ",\"errors\":[{\"location\":{\"begin\":{\"line\":0,\"column\":0}"
         ",\"end\":{\"line\":0,\"column\":0}},\"message\":";
    writeJsonStr(o, message);
    o << "}],\"hotcomments\":[]}";
    g_result = o.str();
    return g_result.c_str();
}

extern "C" {

OBSCURA_EXPORT
const char* obscura_parse(const char* source_cstr) {
    // All C++ exceptions are caught here — they must not cross the WASM boundary.
    // Return string is valid until the NEXT call to obscura_parse().
    // TypeScript wrapper must copy synchronously (cwrap 'string' return type does this).
    try {
        std::string source(source_cstr ? source_cstr : "");

        Luau::Allocator alloc;
        Luau::AstNameTable names(alloc);
        Luau::ParseOptions opts;
        opts.captureComments = true;

        Luau::ParseResult parsed = Luau::Parser::parse(
            source.data(), source.size(), names, alloc, opts);

        // Pre-order DFS: assign all local IDs before serializing the tree
        LocalTable lt;
        LocalCollector collector(lt);
        parsed.root->visit(&collector);

        std::ostringstream o;
        buildResult(o, source, lt, parsed.root, parsed.errors, parsed.hotcomments);
        g_result = o.str();

    } catch (const std::exception& e) {
        return buildError(std::string("Internal serializer error: ") + e.what());
    } catch (...) {
        return buildError("Internal serializer error: unknown exception");
    }

    return g_result.c_str();
}

} // extern "C"

// ---------------------------------------------------------------------------
// Native test entry point (compiled with -DOBSCURA_NATIVE_TEST)
// ---------------------------------------------------------------------------

#ifdef OBSCURA_NATIVE_TEST
#include <iostream>
int main(int argc, char** argv) {
    const char* source =
        "local x = 1\n"
        "local function foo(a, b)\n"
        "  return x + a + b\n"
        "end\n"
        "print(foo(2, 3))\n";

    if (argc > 1) {
        // Read file if provided
        FILE* f = fopen(argv[1], "rb");
        if (!f) { fprintf(stderr, "Cannot open %s\n", argv[1]); return 1; }
        fseek(f, 0, SEEK_END); long len = ftell(f); fseek(f, 0, SEEK_SET);
        std::string buf(len, '\0');
        (void)fread(&buf[0], 1, len, f); fclose(f);
        std::cout << obscura_parse(buf.c_str()) << std::endl;
    } else {
        std::cout << obscura_parse(source) << std::endl;
    }
    return 0;
}
#endif
