-- This file is part of the Luau programming language and is licensed under MIT License; see LICENSE.txt for details
-- This file is based on Lua 5.x tests -- https://github.com/lua/lua/tree/master/testes
print("testing assignments, logical operators, and constructors")

local unpack = table.unpack

local res, res2 = 27

a, b = 1, 2+3
assert(a==1 and b==5)
a={}
function f() return 10, 11, 12 end
a.x, b, a[1] = 1, 2, f()
assert(a.x==1 and b==2 and a[1]==10)
a[f()], b, a[f()+3] = f(), a, 'x'
assert(a[10] == 10 and b == a and a[13] == 'x')

do
  local f = function (n) local x = {}; for i=1,n do x[i]=i end;
                         return unpack(x) end;
  local a,b,c
  a,b = 0, f(1)
  assert(a == 0 and b == 1)
  A,b = 0, f(1)
  assert(A == 0 and b == 1)
  a,b,c = 0,5,f(4)
  assert(a==0 and b==5 and c==1)
  a,b,c = 0,5,f(0)
  assert(a==0 and b==5 and c==nil)
end


a, b, c, d = 1 and nil, 1 or nil, (1 and (nil or 1)), 6
assert(not a and b and c and d==6)

d = 20
a, b, c, d = f()
assert(a==10 and b==11 and c==12 and d==nil)
a,b = f(), 1, 2, 3, f()
assert(a==10 and b==1)

assert(a<b == false and a>b == true)
assert((10 and 2) == 2)
assert((10 or 2) == 10)
assert((10 or assert(nil)) == 10)
assert(not (nil and assert(nil)))
assert((nil or "alo") == "alo")
assert((nil and 10) == nil)
assert((false and 10) == false)
assert((true or 10) == true)
assert((false or 10) == 10)
assert(false ~= nil)
assert(nil ~= false)
assert(not nil == true)
assert(not not nil == false)
assert(not not 1 == true)
assert(not not a == true)
assert(not not (6 or nil) == true)
assert(not not (nil and 56) == false)
assert(not not (nil and true) == false)
print('+')
