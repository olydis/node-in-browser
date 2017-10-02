const { exec } = require("child_process");

module.exports = async (fixtureName, browser) => {
  // package
  const package = require(`./fixtures/${fixtureName}/package.json`);

  const result = await new Promise(res => exec(`node ${browser ? "browserRunner" : ""} fixtures/${fixtureName}`, { cwd: __dirname, }, (err, stdout, stderr) => res({ stdout, stderr })));
  if (!result.stdout.includes(package.marker) && !result.stderr.includes(package.marker))
    throw new Error("End marker not found.");
  return result;
};

// entry point
if (require.main === module)
  (async () => console.log(JSON.stringify(await module.exports(process.argv[2], process.argv[3] === "true"), null, 2)))();