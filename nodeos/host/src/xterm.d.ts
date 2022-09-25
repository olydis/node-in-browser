/// <reference path="../../../node_modules/xterm/typings/xterm.d.ts" />

import { Terminal as T } from "xterm";

declare global {
  type Terminal = T;
  const Terminal: typeof T;
}