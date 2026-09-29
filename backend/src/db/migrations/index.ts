import init from "./0001_init.js";

export interface Migration {
  /** Applied in this order; never rename or reorder one that has shipped. */
  id: string;
  statements: string[];
}

/** Every migration, oldest first. Add new ones as `000N_name.ts` and list them here. */
export const MIGRATIONS: Migration[] = [{ id: "0001_init", statements: init }];
