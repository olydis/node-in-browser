console.log(1 / 3);
console.log("asd");
console.log(true);
console.log([1, 2, 3]);
console.log({ a: 3, b: 4, o: { c: "s", d: [] } });
console.log(__filename);
__filename = 42;
console.log(__filename);
console.log(__dirname);

console.log("Error/Stack");
console.log(new Error("asd").stack);

console.log("global");
var x = 3;
global.y = 4;
console.log(typeof y);
console.log(typeof z);
console.log(typeof global);
console.log(typeof global.self);
console.log(typeof self);
console.log(Object.keys(global));
console.log(Object.getOwnPropertyNames(global));
console.log(global.require);

console.log("path");
console.log(require("path").join("asd", "qwe"));
const req = require;
console.log(require("path").dirname("/asd/qwe/foo"));

console.log("process");
console.log(process.cwd());
console.log(process.domain);
console.log(process.execArgv);
console.log(process.execPath);
console.log(process.pid);
console.log(process.platform);
console.log(process.arch);

throw new Error(require("./package.json").marker);