"use strict";

const { BrowserWindow, dialog, app } = require("electron");
const { createReadStream, createWriteStream, readdirSync, statSync, readFileSync } = require("fs");

const parent_stdin = createReadStream(null, { fd: 3 });
const parent_stdout = createWriteStream(null, { fd: 4 });
const parent_stderr = createWriteStream(null, { fd: 5 });

const testCase = process.argv[2];

// package
const packageJson = require(`../${testCase}/package.json`);

// browser init
const win = new BrowserWindow({ show: false });
// win.webContents.toggleDevTools();
// win.maximize();
// win.setMenu(null);

win.loadURL("http://localhost:8000/index.html");
const page = win.webContents;

page.once("did-finish-load", async () => {
  // page.property("onConsoleMessage", function (msg, lineNum, sourceId) {
  //   console.log('CONSOLE: ' + msg + ' (from line #' + lineNum + ' in "' + sourceId + '")');
  // });
  try {
    // upload test case
    const baseDir = `${__dirname}/..`;
    const copyFolder = async relPath => {
      const dirPath = `${baseDir}${relPath}`;
      const entries = readdirSync(dirPath);
      for (const entry of entries) {
        const stat = statSync(`${dirPath}/${entry}`);
        const relEntityPath = `${relPath}/${entry}`;
        if (stat.isDirectory())
          await copyFolder(relEntityPath);
        else
          await copyFile(relEntityPath);
      }
      await page.executeJavaScript(`self.fs[${JSON.stringify(relPath)}] = null;`);
    };
    const copyFile = async relPath => {
      const filePath = `${baseDir}${relPath}`;
      const contents = readFileSync(filePath);
      await page.executeJavaScript(`self.fs[${JSON.stringify(relPath)}] = ${JSON.stringify(contents.toString())};`);
    };
    await page.executeJavaScript("self.fs = {};");
    await copyFolder(`/${testCase}`);

    // launch
    await page.executeJavaScript(`new VirtualMachine(self.fs).node(["/" + ${JSON.stringify(testCase)}]);`);

    // wait for results
    while (true) {
      const stdout = await page.executeJavaScript(`document.getElementById("stdout").textContent`);
      const stderr = await page.executeJavaScript(`document.getElementById("stderr").textContent`);
      if (stdout.includes(packageJson.marker) || stderr.includes(packageJson.marker)) {
        parent_stdout.end(stdout);
        parent_stderr.end(stderr);
        app.exit(0);
      }
      await new Promise(res => setTimeout(res, 1000));
    }
  } catch (e) {
    dialog.showErrorBox("error running test script", "" + e);
  }
});