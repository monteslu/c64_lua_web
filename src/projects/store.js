// store.js — c64lua's project database.
//
// The implementation is shared (luacretro-web/ide); only the database name is
// ours, so c64lua projects never collide with another IDE on the same origin.
import { createProjectStore } from "luacretro-web/ide";

export const {
  listProjects, getProject, createProject, saveProject, deleteProject,
} = createProjectStore("c64lua-ide");
