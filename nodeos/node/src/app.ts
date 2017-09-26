/// <reference path="../../types/vfs.ts" />
/// <reference path="../../types/env.ts" />
{
  // stack trace manipulation
  type StackFrame = { func?: string, file: string, line: number, column: number };
  type StackTrace = {}
  const getStackTrace = () => new Error().stack;


  const selfAny: any = self;
  let env: Environment;
  const errAny = (e: any): never => { throw e; };
  const err = (message: string): never => { throw new Error(message); };

  // rescue required browser/worker-specific globals
  const URL = selfAny.URL;
  const Blob = selfAny.Blob;
  const postMessage = selfAny.postMessage;
  const XMLHttpRequest = selfAny.XMLHttpRequest;
  const exit = selfAny.close;

  const readFileSync = (absolutePath: string): string | null => {
    // - try vfs
    {
      if (absolutePath in env.fs) return env.fs[absolutePath];
    }
    // - try server
    if (!env.fs["__NOHTTP"]) {
      const request = new XMLHttpRequest();
      request.open('GET', absolutePath, false);
      request.send(null);
      if (request.status === 200) {
        //   // rule out directory listings
        //   const drequest = new XMLHttpRequest();
        //   drequest.open('GET', absolutePath + '/', false);
        //   drequest.send(null);
        // if (drequest.status !== 200) 
        return env.fs[absolutePath] = request.responseText;
      }
    }
    // - fail
    return env.fs[absolutePath] = null;
  }
  const existsSync = (absolutePath: string): boolean => readFileSync(absolutePath) !== null;
  const join = (basePath: string, relative: string) => {
    let path = basePath + '/' + relative;
    function normalizeArray(parts: string[]) {
      var up = 0;
      for (var i = parts.length - 1; i >= 0; i--) {
        var last = parts[i];
        if (last === '.') {
          parts.splice(i, 1);
        } else if (last === '..') {
          parts.splice(i, 1);
          up++;
        } else if (up) {
          parts.splice(i, 1);
          up--;
        }
      }
      return parts;
    }
    path = normalizeArray(path.split('/').filter(p => !!p)).join('/');
    return '/' + path;
  };

  const boot = () => {
    let global: NodeJS.Global = self as any;

    const requireCommon: { // same regardless of scope or executing script
      cache: { [path: string]: { exports: any, internalUrl?: string, error?: any, referenceStackFrame?: string } }
    } = { cache: {} };
    const requireInternalJS = (__filename: string, content: string) => {
      // variables
      const __dirname = (() => {
        let result = (/^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/.exec(__filename) || []).slice(1),
          root = result[0],
          dir = result[1];
        if (!root && !dir) return '.';
        if (dir) dir = dir.substr(0, dir.length - 1);
        return root + dir;
      })();

      // decorate
      const prepared = `
{
  let __filename = ${JSON.stringify(__filename)};
  let __dirname = ${JSON.stringify(__dirname)};
  let require = global.MAKE_REQUIRE(__dirname);
  let module = require.cache[__filename];
  let exports = module.exports;
  let self = {}; // approximation; looks like we can't remove 'self' from 'global'
  try {
    (() => {
${content.startsWith("#!") ? "//" + content : content}
    })();
  } catch (err) {
    module.error = err; // rescue error across 'importScripts' boundaries (appears to ruin stack trace)
  }
  require.cache[__filename].referenceStackFrame = new Error().stack.split('\\n')[1];
}`;
      // for stack trace sanitization
      const preparedLineCountPrefix = 10;
      const preparedLineCountCallToReference = 4;

      // dispatch
      const url = URL.createObjectURL(new Blob([prepared], { type: "text/javascript" }));
      requireCommon.cache[__filename] = { exports: {}, internalUrl: url };
      importScripts(url);
      // error?
      const result = requireCommon.cache[__filename];
      if ("error" in result) {
        // sanitize stack trace
        if (result.error && typeof result.error.stack === "string") {
          let stack: string = result.error.stack;
          for (const knownModulePath of Object.keys(requireCommon.cache)) {
            const cache = requireCommon.cache[knownModulePath];
            const referenceStackFrame = cache.referenceStackFrame;
            if (referenceStackFrame) {
              // strip IIFE frames 
              let indicator: string;
              referenceStackFrame.replace(new RegExp(`^([ ]*at .*)(${cache.internalUrl})(\\:)(\\d+)`, "m"), (_, a, b, c, d) => indicator = `${b}${c}${parseInt(d) - preparedLineCountCallToReference}`);
              stack = stack.split('\n').filter(l => !l.includes(indicator)).join('\n');
              // translate paths and line numbers
              stack = stack.replace(new RegExp(`^([ ]*at .*)${cache.internalUrl}(\\:)(\\d+)`, "gm"), (_, a, b, c) => `${a}${knownModulePath}${b}${parseInt(c) - preparedLineCountPrefix}`);
            }
          }
          result.error.stack = stack;
        }
        // clear cache entry
        delete requireCommon.cache[__filename];
        // replay
        throw result.error;
      }
    };
    const requireInternalJSON = (__filename: string, content: string) => {
      requireCommon.cache[__filename] = { exports: JSON.parse(content) };
    };
    const requireInternal = (absolutePath: string) => {
      if (!(absolutePath in requireCommon.cache)) {
        // load script
        const content = readFileSync(absolutePath);
        // fail?
        if (typeof content !== "string") throw new Error(`Cannot find module '${absolutePath}'`);

        postMessage({ f: "__trace.require", x: absolutePath });

        if (absolutePath.endsWith(".js")) requireInternalJS(absolutePath, content);
        else if (absolutePath.endsWith(".json")) requireInternalJSON(absolutePath, content);
        else requireInternalJS(absolutePath, content);
      }
      return requireCommon.cache[absolutePath].exports;
    };

    // core modules
    const coreModuleNames = new Set<string>([
      "buffer", "constants", "events", "http", "path", "stream", "util",
      "fs"
    ]);
    for (const coreModuleName of coreModuleNames)
      env.fs[coreModuleName] = `module.exports = require("/core_modules/${coreModuleName}")`;
    // built-in
    { // fs
      type PathLike = string | Buffer | URL;
      requireCommon.cache["fs"] = {
        exports: {
          readFileSync: (path: PathLike | number, options?: { encoding?: string | null; flag?: string; } | string | null): string | Buffer => {
            postMessage({ f: "__trace.fs", x: path });
            const file = readFileSync(path.toString());
            if (file === null) throw new Error(`File '${path}' not found`); // TODO: compliance
            return file;
          }
        }
      };
    }

    // const requireCoreModule = (name: string) =>
    const requireResolveFactory = (basePath: string) => (path: string): string => {
      // core modules
      if (coreModuleNames.has(path)) return path;

      // absolute?
      if (path.startsWith('/')) {
        if (existsSync(path)) return path;
        if (existsSync(path + ".js")) return path + ".js";
        if (existsSync(path + ".json")) return path + ".json";
        if (existsSync(join(path, "package.json"))) {
          try {
            const main = requireInternal(join(path, "package.json")).main || "index.js";
            if (main) return requireResolveFactory(basePath)(join(path, main));
          } catch (e) { }
        }
        return path; // give up
      }

      // relative?
      if (path.startsWith('.')) return requireResolveFactory(basePath)(join(basePath, path));

      // node_modules
      const attempt = requireResolveFactory(basePath)("./node_modules/" + path);
      if (existsSync(attempt)) return attempt; // hit!
      const basePathUp = join(basePath, "..");
      if (basePathUp !== basePath) return requireResolveFactory(basePathUp)(path); // traverse
      return path; // give up
    };
    const requireFactory = (basePath: string) => {
      const resolve = requireResolveFactory(basePath);
      return Object.assign((path: string): any => requireInternal(resolve(path)), { resolve: resolve });
    }
    const makeRequire = (basePath: string = "/"): NodeRequire => Object.assign(requireFactory(basePath), requireCommon) as any;

    const wantedGlobalProps = [
      'Object', 'Function', 'Array', 'Number',
      'parseFloat', 'parseInt',
      'Boolean', 'String',
      'Symbol', 'Date', 'Promise', 'RegExp',
      'Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError',
      'JSON',
      'Math',
      'Intl',
      'ArrayBuffer', 'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array', 'Uint8ClampedArray', 'DataView',
      'Map', 'Set', 'WeakMap', 'WeakSet',
      'Proxy', 'Reflect',
      'Infinity', 'NaN', 'undefined', // the unconfiguratbles
      'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape', 'unescape',
      'eval',
      'isFinite', 'isNaN',
      'WebAssembly',
      'console',
      // 'DTRACE_NET_SERVER_CONNECTION', 'DTRACE_NET_STREAM_END',
      // 'DTRACE_HTTP_SERVER_REQUEST', 'DTRACE_HTTP_SERVER_RESPONSE',
      // 'DTRACE_HTTP_CLIENT_REQUEST', 'DTRACE_HTTP_CLIENT_RESPONSE',
      // 'COUNTER_NET_SERVER_CONNECTION', 'COUNTER_NET_SERVER_CONNECTION_CLOSE',
      // 'COUNTER_HTTP_SERVER_REQUEST', 'COUNTER_HTTP_SERVER_RESPONSE',
      // 'COUNTER_HTTP_CLIENT_REQUEST', 'COUNTER_HTTP_CLIENT_RESPONSE',
      'global',
      'process',
      'GLOBAL',
      'root',
      'Buffer',
      'clearImmediate', 'clearInterval', 'clearTimeout', 'setImmediate', 'setInterval', 'setTimeout'];

    // delete unwanted globals
    for (const prop of Object.getOwnPropertyNames(global)) {
      if (!wantedGlobalProps.some(p => p === prop)) {
        delete (global as any)[prop];
      }
    }
    // polyfill globals (TODO: use defineProperty, also check property descriptors of preexisting stuff)
    global.root = global.GLOBAL = global.global = global;
    (global as any).MAKE_REQUIRE = makeRequire;
    global.process = <NodeJS.Process><any>{
      exit: (exitCode: number) => {
        // events
        close();
      },
      cwd: () => env.cwd,
      argv: ["node", "script.js", "Hello World from Node Box"],
      env: {},
      stdin: {
        isTTY: true
      },
      version: "v8.0.0"
      // TODO
    };
    global.Buffer = requireInternal("buffer");
    global.clearImmediate = immediateId => global.clearTimeout(immediateId);
    global.setImmediate = (callback, ...args) => global.setTimeout(callback, 0, ...args);
    global.console = {
      log: (x: any) => postMessage({ f: "console.log", x: x + "" }),
      error: (x: any) => postMessage({ f: "console.error", x: x + "" })
    } as any;

    // check
    const errMissingGlobal = (field: string): never => err(`Core boot failure. Missing global definition '${field}'.`);
    for (const prop of wantedGlobalProps) {
      if (!(prop in global)) {
        errMissingGlobal(prop);
      }
    }
  };

  // ENTRY POINT
  selfAny.onmessage = async function (msg: MessageEvent) {
    env = msg.data.env;

    // BOOT
    const nativesKeys = [
      'internal/bootstrap_node',
      'async_hooks',
      'assert',
      'buffer',
      'child_process',
      'console',
      'constants',
      'crypto',
      'cluster',
      'dgram',
      'dns',
      'domain',
      'events',
      'fs',
      'http',
      '_http_agent',
      '_http_client',
      '_http_common',
      '_http_incoming',
      '_http_outgoing',
      '_http_server',
      'https',
      'inspector',
      'module',
      'net',
      'os',
      'path',
      'process',
      'punycode',
      'querystring',
      'readline',
      'repl',
      'stream',
      '_stream_readable',
      '_stream_writable',
      '_stream_duplex',
      '_stream_transform',
      '_stream_passthrough',
      '_stream_wrap',
      'string_decoder',
      'sys',
      'timers',
      'tls',
      '_tls_common',
      '_tls_legacy',
      '_tls_wrap',
      'tty',
      'url',
      'util',
      'v8',
      'vm',
      'zlib',
      'internal/buffer',
      'internal/child_process',
      'internal/cluster/child',
      'internal/cluster/master',
      'internal/cluster/round_robin_handle',
      'internal/cluster/shared_handle',
      'internal/cluster/utils',
      'internal/cluster/worker',
      'internal/encoding',
      'internal/errors',
      'internal/freelist',
      'internal/fs',
      'internal/http',
      'internal/linkedlist',
      'internal/loader/Loader',
      'internal/loader/ModuleJob',
      'internal/loader/ModuleMap',
      'internal/loader/ModuleWrap',
      'internal/loader/resolveRequestUrl',
      'internal/loader/search',
      'internal/net',
      'internal/module',
      'internal/process/next_tick',
      'internal/process/promises',
      'internal/process/stdio',
      'internal/process/warning',
      'internal/process',
      'internal/querystring',
      'internal/process/write-coverage',
      'internal/readline',
      'internal/repl',
      'internal/safe_globals',
      'internal/socket_list',
      'internal/test/unicode',
      'internal/url',
      'internal/util',
      'internal/v8_prof_polyfill',
      'internal/v8_prof_processor',
      'internal/streams/lazy_transform',
      'internal/streams/BufferList',
      'internal/streams/legacy',
      'internal/streams/destroy',
      // 'v8/tools/splaytree',
      // 'v8/tools/codemap',
      // 'v8/tools/consarray',
      // 'v8/tools/csvparser',
      // 'v8/tools/profile',
      // 'v8/tools/profile_view',
      // 'v8/tools/logreader',
      // 'v8/tools/tickprocessor',
      // 'v8/tools/SourceMap',
      // 'v8/tools/tickprocessor-driver',
      // 'node-inspect/lib/_inspect',
      // 'node-inspect/lib/internal/inspect_client',
      // 'node-inspect/lib/internal/inspect_repl'
    ];
    const natives: { [name: string]: string } = {};
    for (const nativesKey of nativesKeys)
      natives[nativesKey] = readFileSync(`/node/${nativesKey}.js`) || err(`missing native '${nativesKey}'`);
    natives["config"] = '\n{"target_defaults":{"cflags":[],"default_configuration":"Release","defines":[],"include_dirs":[],"libraries":[]},"variables":{"asan":0,"coverage":false,"debug_devtools":"node","force_dynamic_crt":0,"host_arch":"x64","icu_data_file":"icudt59l.dat","icu_data_in":"..\\\\..\\\\deps/icu-small\\\\source/data/in\\\\icudt59l.dat","icu_endianness":"l","icu_gyp_path":"tools/icu/icu-generic.gyp","icu_locales":"en,root","icu_path":"deps/icu-small","icu_small":true,"icu_ver_major":"59","node_byteorder":"little","node_enable_d8":false,"node_enable_v8_vtunejit":false,"node_install_npm":true,"node_module_version":57,"node_no_browser_globals":false,"node_prefix":"/usr/local","node_release_urlbase":"https://nodejs.org/download/release/","node_shared":false,"node_shared_cares":false,"node_shared_http_parser":false,"node_shared_libuv":false,"node_shared_openssl":false,"node_shared_zlib":false,"node_tag":"","node_use_bundled_v8":true,"node_use_dtrace":false,"node_use_etw":true,"node_use_lttng":false,"node_use_openssl":true,"node_use_perfctr":true,"node_use_v8_platform":true,"node_without_node_options":false,"openssl_fips":"","openssl_no_asm":0,"shlib_suffix":"so.57","target_arch":"x64","v8_enable_gdbjit":0,"v8_enable_i18n_support":1,"v8_enable_inspector":1,"v8_no_strict_aliasing":1,"v8_optimized_debug":0,"v8_promise_internal_field_count":1,"v8_random_seed":0,"v8_use_snapshot":true,"want_separate_host_toolset":0,"want_separate_host_toolset_mkpeephole":0}}'
      .replace(/"/g, `'`);

    class ContextifyScript {
      public constructor(private code: string, private options: { displayErrors: boolean, filename: string, lineOffset: number }) {

      }

      public runInThisContext(): any {
        return eval(this.code + `\n//# sourceURL=${this.options.filename}`);
      }
    }


    let global: NodeJS.Global = self as any;
    global.global = global;

    const startTime = Date.now();
    const process = {
      _setupProcessObject: (pushValueToArrayFunction: Function) => { },
      _setupPromises: () => { },
      _setupNextTick: () => { },
      binding: (name: string): any => {
        switch (name) {
          case "async_wrap":
            return {
              clearIdStack: () => { },
              asyncIdStackSize: () => { },
              async_hook_fields: [],
              async_uid_fields: [],
              constants: {
                kAfter: 0,
                kCurrentAsyncId: 0,
                kInitTriggerId: 0
              },
              setupHooks: () => { }
            }; // TODO
          case "buffer":
            return {
              setupBufferJS: () => { }
            }; // TODO
          case "cares_wrap":
            return {};// TODO
          case "config":
            return {}; // TODO
          case "constants":
            return JSON.parse('{"os":{"UV_UDP_REUSEADDR":4,"errno":{"E2BIG":7,"EACCES":13,"EADDRINUSE":100,"EADDRNOTAVAIL":101,"EAFNOSUPPORT":102,"EAGAIN":11,"EALREADY":103,"EBADF":9,"EBADMSG":104,"EBUSY":16,"ECANCELED":105,"ECHILD":10,"ECONNABORTED":106,"ECONNREFUSED":107,"ECONNRESET":108,"EDEADLK":36,"EDESTADDRREQ":109,"EDOM":33,"EEXIST":17,"EFAULT":14,"EFBIG":27,"EHOSTUNREACH":110,"EIDRM":111,"EILSEQ":42,"EINPROGRESS":112,"EINTR":4,"EINVAL":22,"EIO":5,"EISCONN":113,"EISDIR":21,"ELOOP":114,"EMFILE":24,"EMLINK":31,"EMSGSIZE":115,"ENAMETOOLONG":38,"ENETDOWN":116,"ENETRESET":117,"ENETUNREACH":118,"ENFILE":23,"ENOBUFS":119,"ENODATA":120,"ENODEV":19,"ENOENT":2,"ENOEXEC":8,"ENOLCK":39,"ENOLINK":121,"ENOMEM":12,"ENOMSG":122,"ENOPROTOOPT":123,"ENOSPC":28,"ENOSR":124,"ENOSTR":125,"ENOSYS":40,"ENOTCONN":126,"ENOTDIR":20,"ENOTEMPTY":41,"ENOTSOCK":128,"ENOTSUP":129,"ENOTTY":25,"ENXIO":6,"EOPNOTSUPP":130,"EOVERFLOW":132,"EPERM":1,"EPIPE":32,"EPROTO":134,"EPROTONOSUPPORT":135,"EPROTOTYPE":136,"ERANGE":34,"EROFS":30,"ESPIPE":29,"ESRCH":3,"ETIME":137,"ETIMEDOUT":138,"ETXTBSY":139,"EWOULDBLOCK":140,"EXDEV":18,"WSAEINTR":10004,"WSAEBADF":10009,"WSAEACCES":10013,"WSAEFAULT":10014,"WSAEINVAL":10022,"WSAEMFILE":10024,"WSAEWOULDBLOCK":10035,"WSAEINPROGRESS":10036,"WSAEALREADY":10037,"WSAENOTSOCK":10038,"WSAEDESTADDRREQ":10039,"WSAEMSGSIZE":10040,"WSAEPROTOTYPE":10041,"WSAENOPROTOOPT":10042,"WSAEPROTONOSUPPORT":10043,"WSAESOCKTNOSUPPORT":10044,"WSAEOPNOTSUPP":10045,"WSAEPFNOSUPPORT":10046,"WSAEAFNOSUPPORT":10047,"WSAEADDRINUSE":10048,"WSAEADDRNOTAVAIL":10049,"WSAENETDOWN":10050,"WSAENETUNREACH":10051,"WSAENETRESET":10052,"WSAECONNABORTED":10053,"WSAECONNRESET":10054,"WSAENOBUFS":10055,"WSAEISCONN":10056,"WSAENOTCONN":10057,"WSAESHUTDOWN":10058,"WSAETOOMANYREFS":10059,"WSAETIMEDOUT":10060,"WSAECONNREFUSED":10061,"WSAELOOP":10062,"WSAENAMETOOLONG":10063,"WSAEHOSTDOWN":10064,"WSAEHOSTUNREACH":10065,"WSAENOTEMPTY":10066,"WSAEPROCLIM":10067,"WSAEUSERS":10068,"WSAEDQUOT":10069,"WSAESTALE":10070,"WSAEREMOTE":10071,"WSASYSNOTREADY":10091,"WSAVERNOTSUPPORTED":10092,"WSANOTINITIALISED":10093,"WSAEDISCON":10101,"WSAENOMORE":10102,"WSAECANCELLED":10103,"WSAEINVALIDPROCTABLE":10104,"WSAEINVALIDPROVIDER":10105,"WSAEPROVIDERFAILEDINIT":10106,"WSASYSCALLFAILURE":10107,"WSASERVICE_NOT_FOUND":10108,"WSATYPE_NOT_FOUND":10109,"WSA_E_NO_MORE":10110,"WSA_E_CANCELLED":10111,"WSAEREFUSED":10112},"signals":{"SIGHUP":1,"SIGINT":2,"SIGILL":4,"SIGABRT":22,"SIGFPE":8,"SIGKILL":9,"SIGSEGV":11,"SIGTERM":15,"SIGBREAK":21,"SIGWINCH":28}},"fs":{"O_RDONLY":0,"O_WRONLY":1,"O_RDWR":2,"S_IFMT":61440,"S_IFREG":32768,"S_IFDIR":16384,"S_IFCHR":8192,"S_IFLNK":40960,"O_CREAT":256,"O_EXCL":1024,"O_TRUNC":512,"O_APPEND":8,"F_OK":0,"R_OK":4,"W_OK":2,"X_OK":1},"crypto":{"SSL_OP_ALL":2147486719,"SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION":262144,"SSL_OP_CIPHER_SERVER_PREFERENCE":4194304,"SSL_OP_CISCO_ANYCONNECT":32768,"SSL_OP_COOKIE_EXCHANGE":8192,"SSL_OP_CRYPTOPRO_TLSEXT_BUG":2147483648,"SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS":2048,"SSL_OP_EPHEMERAL_RSA":0,"SSL_OP_LEGACY_SERVER_CONNECT":4,"SSL_OP_MICROSOFT_BIG_SSLV3_BUFFER":32,"SSL_OP_MICROSOFT_SESS_ID_BUG":1,"SSL_OP_MSIE_SSLV2_RSA_PADDING":0,"SSL_OP_NETSCAPE_CA_DN_BUG":536870912,"SSL_OP_NETSCAPE_CHALLENGE_BUG":2,"SSL_OP_NETSCAPE_DEMO_CIPHER_CHANGE_BUG":1073741824,"SSL_OP_NETSCAPE_REUSE_CIPHER_CHANGE_BUG":8,"SSL_OP_NO_COMPRESSION":131072,"SSL_OP_NO_QUERY_MTU":4096,"SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION":65536,"SSL_OP_NO_SSLv2":16777216,"SSL_OP_NO_SSLv3":33554432,"SSL_OP_NO_TICKET":16384,"SSL_OP_NO_TLSv1":67108864,"SSL_OP_NO_TLSv1_1":268435456,"SSL_OP_NO_TLSv1_2":134217728,"SSL_OP_PKCS1_CHECK_1":0,"SSL_OP_PKCS1_CHECK_2":0,"SSL_OP_SINGLE_DH_USE":1048576,"SSL_OP_SINGLE_ECDH_USE":524288,"SSL_OP_SSLEAY_080_CLIENT_DH_BUG":128,"SSL_OP_SSLREF2_REUSE_CERT_TYPE_BUG":0,"SSL_OP_TLS_BLOCK_PADDING_BUG":512,"SSL_OP_TLS_D5_BUG":256,"SSL_OP_TLS_ROLLBACK_BUG":8388608,"ENGINE_METHOD_RSA":1,"ENGINE_METHOD_DSA":2,"ENGINE_METHOD_DH":4,"ENGINE_METHOD_RAND":8,"ENGINE_METHOD_ECDH":16,"ENGINE_METHOD_ECDSA":32,"ENGINE_METHOD_CIPHERS":64,"ENGINE_METHOD_DIGESTS":128,"ENGINE_METHOD_STORE":256,"ENGINE_METHOD_PKEY_METHS":512,"ENGINE_METHOD_PKEY_ASN1_METHS":1024,"ENGINE_METHOD_ALL":65535,"ENGINE_METHOD_NONE":0,"DH_CHECK_P_NOT_SAFE_PRIME":2,"DH_CHECK_P_NOT_PRIME":1,"DH_UNABLE_TO_CHECK_GENERATOR":4,"DH_NOT_SUITABLE_GENERATOR":8,"NPN_ENABLED":1,"ALPN_ENABLED":1,"RSA_PKCS1_PADDING":1,"RSA_SSLV23_PADDING":2,"RSA_NO_PADDING":3,"RSA_PKCS1_OAEP_PADDING":4,"RSA_X931_PADDING":5,"RSA_PKCS1_PSS_PADDING":6,"RSA_PSS_SALTLEN_DIGEST":-1,"RSA_PSS_SALTLEN_MAX_SIGN":-2,"RSA_PSS_SALTLEN_AUTO":-2,"POINT_CONVERSION_COMPRESSED":2,"POINT_CONVERSION_UNCOMPRESSED":4,"POINT_CONVERSION_HYBRID":6,"defaultCoreCipherList":"ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256:HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA","defaultCipherList":"ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256:HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA"},"zlib":{"Z_NO_FLUSH":0,"Z_PARTIAL_FLUSH":1,"Z_SYNC_FLUSH":2,"Z_FULL_FLUSH":3,"Z_FINISH":4,"Z_BLOCK":5,"Z_OK":0,"Z_STREAM_END":1,"Z_NEED_DICT":2,"Z_ERRNO":-1,"Z_STREAM_ERROR":-2,"Z_DATA_ERROR":-3,"Z_MEM_ERROR":-4,"Z_BUF_ERROR":-5,"Z_VERSION_ERROR":-6,"Z_NO_COMPRESSION":0,"Z_BEST_SPEED":1,"Z_BEST_COMPRESSION":9,"Z_DEFAULT_COMPRESSION":-1,"Z_FILTERED":1,"Z_HUFFMAN_ONLY":2,"Z_RLE":3,"Z_FIXED":4,"Z_DEFAULT_STRATEGY":0,"ZLIB_VERNUM":4784,"DEFLATE":1,"INFLATE":2,"GZIP":3,"GUNZIP":4,"DEFLATERAW":5,"INFLATERAW":6,"UNZIP":7,"Z_MIN_WINDOWBITS":8,"Z_MAX_WINDOWBITS":15,"Z_DEFAULT_WINDOWBITS":15,"Z_MIN_CHUNK":64,"Z_MAX_CHUNK":null,"Z_DEFAULT_CHUNK":16384,"Z_MIN_MEMLEVEL":1,"Z_MAX_MEMLEVEL":9,"Z_DEFAULT_MEMLEVEL":8,"Z_MIN_LEVEL":-1,"Z_MAX_LEVEL":9,"Z_DEFAULT_LEVEL":-1}}');
          case "contextify":
            return {
              ContextifyScript
            }; // TODO
          case "fs":
            return {
              getStatValues: () => new Float64Array([
                1458881089, 33206, 1, 0, 0, 0, -1, 8162774324649504, 58232, -1, 1484478676521.9932, 1506412651257.9966, 1506412651257.9966, 1484478676521.9932,
                0, 0, 0, 0, 0, 0, 0, 1.020383559167285e-309, 7.86961418868e-312, 7.86961069963e-312, 0, 0, 0, 0])
            };// TODO
          case "fs_event_wrap":
            return {};// TODO
          case "pipe_wrap":
            return {};// TODO
          case "module_wrap":
            return {};// TODO
          case "natives":
            return natives;
          case "stream_wrap":
            return {};// TODO
          case "tcp_wrap":
            return {};// TODO
          case "timer_wrap":
            return {
              Timer: {
                // TODO constructor
                kOnTimeout: 0,
                now: () => Date.now() - startTime
              }
            }; // TODO
          case "tty_wrap":
            return {
              isTTY: () => true,
              guessHandleType: (fs: number): string => "TTY"
            };// TODO
          case "url":
            return {
              parse: () => { },
              encodeAuth: () => { },
              toUSVString: () => { },
              domainToASCII: () => { },
              domainToUnicode: () => { },
              setURLConstructor: () => { },
              URL_FLAGS_NONE: 0, URL_FLAGS_FAILED: 1, URL_FLAGS_CANNOT_BE_BASE: 2, URL_FLAGS_INVALID_PARSE_STATE: 4, URL_FLAGS_TERMINATED: 8, URL_FLAGS_SPECIAL: 16, URL_FLAGS_HAS_USERNAME: 32, URL_FLAGS_HAS_PASSWORD: 64, URL_FLAGS_HAS_HOST: 128, URL_FLAGS_HAS_PATH: 256, URL_FLAGS_HAS_QUERY: 512, URL_FLAGS_HAS_FRAGMENT: 1024,
              kSchemeStart: 0, kScheme: 1, kNoScheme: 2, kSpecialRelativeOrAuthority: 3, kPathOrAuthority: 4, kRelative: 5, kRelativeSlash: 6, kSpecialAuthoritySlashes: 7, kSpecialAuthorityIgnoreSlashes: 8, kAuthority: 9, kHost: 10, kHostname: 11, kPort: 12, kFile: 13, kFileSlash: 14, kFileHost: 15, kPathStart: 16, kPath: 17, kCannotBeBase: 18, kQuery: 19, kFragment: 20
            };
          case "util":
            return {}; // TODO
          case "uv":
            return {
              errname: function () { return `errname(${arguments})`; },
              UV_E2BIG: -4093, UV_EACCES: -4092, UV_EADDRINUSE: -4091, UV_EADDRNOTAVAIL: -4090, UV_EAFNOSUPPORT: -4089, UV_EAGAIN: -4088, UV_EAI_ADDRFAMILY: -3000, UV_EAI_AGAIN: -3001, UV_EAI_BADFLAGS: -3002, UV_EAI_BADHINTS: -3013, UV_EAI_CANCELED: -3003, UV_EAI_FAIL: -3004, UV_EAI_FAMILY: -3005, UV_EAI_MEMORY: -3006, UV_EAI_NODATA: -3007, UV_EAI_NONAME: -3008, UV_EAI_OVERFLOW: -3009, UV_EAI_PROTOCOL: -3014, UV_EAI_SERVICE: -3010, UV_EAI_SOCKTYPE: -3011, UV_EALREADY: -4084, UV_EBADF: -4083, UV_EBUSY: -4082, UV_ECANCELED: -4081, UV_ECHARSET: -4080, UV_ECONNABORTED: -4079, UV_ECONNREFUSED: -4078, UV_ECONNRESET: -4077, UV_EDESTADDRREQ: -4076, UV_EEXIST: -4075, UV_EFAULT: -4074, UV_EFBIG: -4036, UV_EHOSTUNREACH: -4073, UV_EINTR: -4072, UV_EINVAL: -4071, UV_EIO: -4070, UV_EISCONN: -4069, UV_EISDIR: -4068, UV_ELOOP: -4067, UV_EMFILE: -4066, UV_EMSGSIZE: -4065, UV_ENAMETOOLONG: -4064, UV_ENETDOWN: -4063, UV_ENETUNREACH: -4062, UV_ENFILE: -4061, UV_ENOBUFS: -4060, UV_ENODEV: -4059, UV_ENOENT: -4058, UV_ENOMEM: -4057, UV_ENONET: -4056, UV_ENOPROTOOPT: -4035, UV_ENOSPC: -4055, UV_ENOSYS: -4054, UV_ENOTCONN: -4053, UV_ENOTDIR: -4052, UV_ENOTEMPTY: -4051, UV_ENOTSOCK: -4050, UV_ENOTSUP: -4049, UV_EPERM: -4048, UV_EPIPE: -4047, UV_EPROTO: -4046, UV_EPROTONOSUPPORT: -4045, UV_EPROTOTYPE: -4044, UV_ERANGE: -4034, UV_EROFS: -4043, UV_ESHUTDOWN: -4042, UV_ESPIPE: -4041, UV_ESRCH: -4040, UV_ETIMEDOUT: -4039, UV_ETXTBSY: -4038, UV_EXDEV: -4037, UV_UNKNOWN: -4094, UV_EOF: -4095, UV_ENXIO: -4033, UV_EMLINK: -4032, UV_EHOSTDOWN: -4031
            }
          default:
            throw new Error(`missing binding '${name}'`);
        }
      },
      cwd: () => "/",
      env: {},
      execPath: "/prefix/bin/node",
      moduleLoadList: [] as string[],
      pid: 42,
      release: {
        name: "node-box"
      },
      version: "v8.0.0",
      versions: {
        http_parser: '2.7.0',
        node: '8.0.0',
        v8: '5.8.283.41',
        uv: '1.11.0',
        zlib: '1.2.11',
        ares: '1.10.1-DEV',
        modules: '57',
        openssl: '1.0.2k',
        icu: '59.1',
        unicode: '9.0',
        cldr: '31.0.1',
        tz: '2017b'
      }
    };
    Object.setPrototypeOf(process, {});

    const bootstrapper = new ContextifyScript(natives["internal/bootstrap_node"], { displayErrors: true, filename: "internal/bootstrap_node", lineOffset: 0 });
    const bootstrap = bootstrapper.runInThisContext();
    bootstrap(process);

    selfAny.process = process;
    while (true) {
      console.log('asd');
      await new Promise(res => setTimeout(res, 1000));
    }

    // boot();
    // (global as any).MAKE_REQUIRE(env.cwd)(msg.data.script);
    // postMessage({ f: "__trace.fs", x: env.fs });
  };

  // selfAny.onerror = function (ev: any) { console.error(ev); };
}
