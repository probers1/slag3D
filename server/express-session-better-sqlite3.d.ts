declare module 'express-session-better-sqlite3' {
  import type { Store } from 'express-session';

  type SessionStoreConstructor = new () => Store;

  const createStore: (session: any, db: any) => SessionStoreConstructor;

  export default createStore;
}
