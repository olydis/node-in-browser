"use strict";
const electron = require("electron");
const { spawn } = require("child_process");
if (typeof electron === "string")
  spawn(electron, [__filename, ...process.argv.slice(2)], { stdio: ["ignore", "ignore", "ignore", process.stdin, process.stdout, process.stderr] });
else
  electron.app.on("ready", () => require("./app"));