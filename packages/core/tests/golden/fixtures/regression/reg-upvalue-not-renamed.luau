-- Regression: upvalue locals must not be renamed independently from their closure
-- Tests that x inside inner() references the same binding as x in outer scope
local x = 10
local function outer()
    local function inner()
        return x  -- x is upvalue; renaming must be consistent
    end
    return inner() + x
end
assert(outer() == 20)
print("upvalue-regression: ok")
