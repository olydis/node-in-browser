
type ByteBuffer = Uint8Array;

interface VirtualFileSystem {
  [path: string]: ByteBuffer | null | undefined; // TODO: do right
}