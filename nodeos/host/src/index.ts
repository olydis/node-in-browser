/// <reference path="../../types/vfs.ts" />
/// <reference path="../../types/env.ts" />

/**
 * Represents an execution environment, i.e. virtual OS with architecture, FS, etc.
 * Can host multiple workers that will have a consistent view of the FS, process.arch, etc.
 */
class VirtualMachine {
  public constructor(private fs: VirtualFileSystem) {

  }

  private syscall(origin: Worker, func: string, arg: any): void {
    switch (func) {
      case "console.log":
        eval("document").getElementById("console").innerHTML += arg + "\n";
        break;
      case "console.error":
        eval("document").getElementById("console").innerHTML += arg + "\n";
        break;
      case "__trace.fs":
      case "__trace.require":
        eval("document").getElementById("console").innerHTML += `[${func}] ${arg}\n`;
        break;
      // case "__trace.fs":
      //   console.log(JSON.stringify(arg, null, 2));
      //   break;
    }
  }

  /**
   * Dummy entry point for "node" binary. Long term, this should be hooked into the FS somehow and resolved via $PATH etc.
   */
  public node(script: string): void {
    const vm = this;
    const worker = new Worker("/bin/node/app.js");
    worker.onmessage = function (ev: MessageEvent) { const { f, x } = ev.data; vm.syscall(this, f, x); };
    // worker.onerror = function (ev: ErrorEvent) { console.error(ev.error); };
    const env: Environment = { fs: this.fs, cwd: "/cwd" };
    worker.postMessage({ script, env });
  }
}

function testFixture() {
  new VirtualMachine({}).node("/playground/fixture.js");
}

function testStack() {
  new VirtualMachine({}).node("/playground/stack/a.js");
}

function dragover_handler(ev: DragEvent) {
  ev.preventDefault();
  ev.dataTransfer.dropEffect = "link";
}

async function drop_handler(ev: DragEvent) {
  ev.preventDefault();

  const fs: VirtualFileSystem = {};
  const todo = new Set<string>();
  const traverse = async (entry: any, path: string) => {
    if (entry.isFile) {
      const name = path + entry.name;
      // Get file
      try {
        await new Promise<void>((res, req) => entry.file(
          (f: File) => {
            todo.add(name);
            const reader = new FileReader();
            reader.onloadend = () => {
              fs[name] = reader.result;
              todo.delete(name);
              // console.log(name);
              (document.getElementById("status") as any).textContent = name;
              res();
            };
            reader.onerror = () => console.error(name);
            reader.readAsText(f);
          },
          req)
        );
      } catch (e) { console.error(`Error loading '${name}'`) }
    } else if (entry.isDirectory) {
      // Get folder contents
      const dirReader = entry.createReader();
      const jobs: any[] = [];
      await new Promise<void>(res => dirReader.readEntries((entries: any) => {
        for (var i = 0; i < entries.length; i++)
          jobs.push(entries[i]);
        res();
      }));
      for (const job of jobs)
        await traverse(job, path + entry.name + "/");
    }
  };
  var items = ev.dataTransfer.items;
  for (var i = 0; i < items.length; ++i) {
    const item = items[i];
    if (item.kind != "file")
      continue;
    await traverse(item.webkitGetAsEntry(), "/");
  }

  console.log("DONE");
  const firstPath = Object.keys(fs)[0];
  if (!firstPath) return;
  console.log("PROBE PATH: " + firstPath);
  new VirtualMachine(fs).node("/" + firstPath.split('/')[1]);
}