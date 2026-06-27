import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import path from "path";

export interface ProjectRecord {
  id: string;
  path: string;
  name: string;
  port: number;
  language: string;
  registeredAt: string;
  lastSeenAt: string;
  sessionCount: number;
  totalSavedTokens: number;
}

interface RegistryData {
  version: 1;
  projects: Record<string, ProjectRecord>;
}

export const TOKENSAGE_DIR = path.join(homedir(), ".tokensage");
const REGISTRY_PATH = path.join(TOKENSAGE_DIR, "registry.json");

function ensureDir(): void {
  if (!existsSync(TOKENSAGE_DIR)) mkdirSync(TOKENSAGE_DIR, { recursive: true });
}

function load(): RegistryData {
  ensureDir();
  if (!existsSync(REGISTRY_PATH)) return { version: 1, projects: {} };
  try { return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as RegistryData; }
  catch { return { version: 1, projects: {} }; }
}

function save(data: RegistryData): void {
  ensureDir();
  writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2), "utf-8");
}

export class ProjectRegistry {
  private data: RegistryData;
  constructor() { this.data = load(); }

  register(p: Omit<ProjectRecord, "registeredAt" | "lastSeenAt" | "sessionCount" | "totalSavedTokens">): ProjectRecord {
    const ex = this.data.projects[p.id];
    const rec: ProjectRecord = {
      ...p,
      registeredAt: ex?.registeredAt ?? new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      sessionCount: (ex?.sessionCount ?? 0) + 1,
      totalSavedTokens: ex?.totalSavedTokens ?? 0,
    };
    this.data.projects[p.id] = rec;
    save(this.data);
    return rec;
  }

  updateSavings(id: string, saved: number): void {
    const p = this.data.projects[id];
    if (p) { p.totalSavedTokens += saved; p.lastSeenAt = new Date().toISOString(); save(this.data); }
  }

  getAll(): ProjectRecord[] {
    return Object.values(this.data.projects).sort(
      (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
    );
  }

  get(id: string): ProjectRecord | undefined { return this.data.projects[id]; }
  remove(id: string): void { delete this.data.projects[id]; save(this.data); }
}
