const { exec } = require("child_process");

module.exports.run = async (fixtureName, browser) => {
  // package
  const package = require(`./fixtures/${fixtureName}/package.json`);

  const result = await new Promise(res => exec(`node ${browser ? "browserRunner" : ""} fixtures/${fixtureName}`, { cwd: __dirname, }, (err, stdout, stderr) => res({ stdout, stderr })));
  if (!result.stdout.includes(package.marker) && !result.stderr.includes(package.marker))
    throw new Error("End marker not found.");
  return result;
};

module.exports.compare = async (fixtureName) => {
  const expected = await module.exports.run(fixtureName, false);
  const actual = await module.exports.run(fixtureName, true);
  return { expected, actual };
};

// entry point
if (require.main === module)
  if (process.argv[3])
    (async () => console.log(JSON.stringify(await module.exports.run(process.argv[2], process.argv[3] === "true"), null, 2)))();
  else
    (async () => console.log(JSON.stringify(await module.exports.compare(process.argv[2]), null, 2)))();