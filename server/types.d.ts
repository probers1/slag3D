declare module 'connect-sqlite3' {
  import { SessionData, Store } from 'express-session';
  import expressSession from 'express-session';

  interface SQLiteStoreOptions {
    table?: string;
    db?: string;
    dir?: string;
    concurrentDB?: boolean;
  }

  function init(session: typeof expressSession): {
    new (options?: SQLiteStoreOptions): Store;
  };

  export default init;
}
