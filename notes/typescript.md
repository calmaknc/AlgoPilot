# TypeScript 基础

## 类型与运行时

TypeScript 在 JavaScript 上增加类型检查。类型声明通常在运行前被移除，不会自动验证接口返回的 JSON。来自用户、文件或模型的数据仍需要运行时校验。

## 联合类型

联合类型表示一个值可以属于多个指定类型，用竖线 `|` 连接。例如 `string | null` 表示字符串或空值。

```ts
type Role = 'user' | 'assistant' | 'system';
type Message = {
  role: Role;
  content: string;
};
```

这里的 Role 只能取三个指定字符串。Message[] 表示由消息对象组成的数组。

## 可选属性与可选链

`content?: string` 表示 content 属性可以不存在，读取时可能得到 undefined。

`message?.content` 是可选链：当 message 为 null 或 undefined 时，返回 undefined，而不是继续访问属性。

## 类型收窄

类型收窄是通过条件判断缩小变量可能的类型范围。例如先判断 `typeof value === 'string'`，就能在分支内调用 value.trim()。

## 严格相等

`===` 不进行隐式类型转换，`==` 可能进行转换。通常优先使用 `===`。对象和数组比较的是引用，即使内容相同，两个独立对象也不严格相等。

## const 与对象修改

const 禁止变量重新赋值，但不禁止修改它引用的对象。使用 const 声明数组后仍能调用 push；不能给变量重新赋一个数组。
