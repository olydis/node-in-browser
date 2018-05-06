/// <reference path="../../types/vfs.ts" />
/// <reference path="../../types/env.ts" />
/// <reference path="../../../node_modules/@types/xterm/index.d.ts" />

eval("self.Xterm = Terminal"); // alias, somehow the typings talk about "Xterm"
const terminal = new Xterm(<Xterm.IOptions>{ cursorBlink: true, cols: 120, rows: 30, convertEol: true, });

/**
 * Represents an execution environment, i.e. virtual OS with architecture, FS, etc.
 * Can host multiple workers that will have a consistent view of the FS, process.arch, etc.
 */
class VirtualMachine {
  public constructor(private fs: VirtualFileSystem, private terminal: Xterm) {

  }

  private syscall(origin: Worker, func: string, arg: any): void {
    switch (func) {
      case "stdout":
        this.terminal.write(arg);
        eval("document").getElementById("stdout").textContent += arg;
        break;
      case "stderr":
        this.terminal.write(arg);
        eval("document").getElementById("stderr").textContent += arg;
        break;
      case "error":
        this.terminal.write("[Runtime Error]\n");
        this.terminal.write(arg + "\n");
        if (arg.stack)
          this.terminal.write(arg.stack + "\n");
        break;
      // case "__trace.fs":
      // case "__trace.require":
      //   eval("document").getElementById("console").textContent += `[${func}] ${arg}\n`;
      //   break;
      // case "__trace.fs":
      //   console.log(JSON.stringify(arg, null, 2));
      //   break;
      case "WRITE":
        this.fs[arg.path] = arg.content;
        break;
      case "EXIT":
        const exitCode = arg;
        origin.terminate();
        break;
    }
  }

  /**
   * Dummy entry point for "node" binary. Long term, this should be hooked into the FS somehow and resolved via $PATH etc.
   */
  public node(args: string[], keepAlive: boolean = false): void {
    eval("document").getElementById("stdout").textContent = "";
    eval("document").getElementById("stderr").textContent = "";
    this.terminal.clear();
    const vm = this;
    const worker = new Worker("/bin/node/app.js");
    if (keepAlive) (self as any)._keepAlive = worker;
    worker.onmessage = function (ev: MessageEvent) { const { f, x } = ev.data; vm.syscall(this, f, x); };
    // worker.onerror = function (ev: ErrorEvent) { console.error(JSON.stringify(ev, null, 2)); };
    const env: Environment = { fs: this.fs, cwd: "/cwd" };
    worker.postMessage({ type: "start", args, env });

    this.terminal.on("data", (ch: string) => {
      if (ch.length > 8) { // assume paste (TODO: clean, see VSCode recent developments)
        worker.postMessage({
          type: "stdin",
          ch: ch
        });
      }
      if (ch.length === 1) {
        switch (ch.charCodeAt(0)) {
          case 3: // Ctrl + C
            break;
          case 22: // Ctrl + V
            break;
        }
      }
    });
    this.terminal.on("key", (ch: string, key) => {
      worker.postMessage({
        type: "stdin",
        ch: ch,
        key: {
          name: key.key.toLowerCase().replace(/^arrow/, ""),
          ctrl: key.ctrlKey,
          shift: key.shiftKey,
          meta: key.metaKey,
          alt: key.altKey
        }
      });
    });
  }
}

function dragover_handler(ev: DragEvent) {
  ev.preventDefault();
  ev.dataTransfer.dropEffect = "link";
}

async function drop_handler(ev: DragEvent) {
  ev.preventDefault();

  const fs: VirtualFileSystem = {};
  const todo = new Set<string>();
  const traverse = async (entry: any, path: string): Promise<void> => {
    const name = path + entry.name;
    if (entry.isFile) {
      // Get file
      try {
        await new Promise<void>((res, req) => entry.file(
          (f: File) => {
            todo.add(name);
            const reader = new FileReader();
            reader.onloadend = () => {
              fs[name] = new Uint8Array(reader.result);
              todo.delete(name);
              // console.log(name);
              (document.getElementById("status") as any).textContent = name;
              res();
            };
            reader.onerror = () => console.error(name);
            reader.readAsArrayBuffer(f);
          },
          req)
        );
      } catch (e) { console.error(`Error loading '${name}'`) }
    } else if (entry.isDirectory) {
      fs[name] = null;
      // Get folder contents
      const dirReader = entry.createReader();
      const jobs: Promise<void>[] = [];
      await new Promise<void>(res => dirReader.readEntries((entries: any) => {
        for (var i = 0; i < entries.length; i++)
          jobs.push(traverse(entries[i], name + "/"));
        res();
      }));
      await Promise.all(jobs);
    }
  };
  var items = ev.dataTransfer.items;
  for (var i = 0; i < items.length; ++i) {
    const item = items[i];
    if (item.kind != "file")
      continue;
    await traverse(item.webkitGetAsEntry(), "/");
  }
  (document.getElementById("status") as any).textContent = "";

  console.log("done loading");
  const firstPath = Object.keys(fs)[0];
  if (!firstPath) return;

  const vm = new VirtualMachine(fs, terminal);
  const start = (args: string[], keepAlive: boolean) => { console.log(args); vm.node(args, keepAlive); };
  (self as any).node = (...args: string[]) => start(args, false);
  (self as any).nodeDebug = (...args: string[]) => start(args, true);
  start(["/" + firstPath.split('/')[1]], false);
}
function load() {
  const terminalDiv = document.getElementById("xterm") as HTMLElement;
  terminal.open(terminalDiv, true);
  const term = terminal as any;
  const resize = () => {
    const cw = term.charMeasure.width;
    const ch = term.charMeasure.height;
    if (cw && ch)
      terminal.resize(terminalDiv.clientWidth / cw | 0, terminalDiv.clientHeight / ch | 0);
    // TODO: need to communicate that to process!
  };
  terminal.on("title", title => document.title = title); // console.log(`${String.fromCharCode(27)}]0;${title}${String.fromCharCode(7)}`)
  (document.body as any).onresize = resize;
  setInterval(resize, 500);

  new VirtualMachine({}, terminal).node([], false)
  // new VirtualMachine({}, terminal).node(["node_modules/npm", "install", "--no-save", "semver"], false)
  // new VirtualMachine({}, terminal).node(["node_modules/npm", "help"], false)
}