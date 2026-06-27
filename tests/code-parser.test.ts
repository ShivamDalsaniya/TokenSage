import { describe, it, expect } from "vitest";
import { detectLanguage, parseCode, inferPurpose } from "../src/parsers/code-parser.js";
import { isTreeSitterAvailable, parseWithTreeSitter } from "../src/parsers/tree-sitter-parser.js";

describe("detectLanguage", () => {
  it("detects TypeScript", () => {
    expect(detectLanguage("foo.ts")).toBe("typescript");
    expect(detectLanguage("bar.tsx")).toBe("typescript");
  });

  it("detects JavaScript", () => {
    expect(detectLanguage("app.js")).toBe("javascript");
    expect(detectLanguage("index.mjs")).toBe("javascript");
  });

  it("detects Python", () => {
    expect(detectLanguage("script.py")).toBe("python");
  });

  it("returns unknown for unrecognized", () => {
    expect(detectLanguage("data.json")).toBe("unknown");
    expect(detectLanguage("README.md")).toBe("unknown");
  });
});

describe("parseCode - TypeScript", () => {
  const tsCode = `
/**
 * Authentication service for JWT tokens.
 */
import { sign, verify } from 'jsonwebtoken';
import type { User } from './types';

export interface AuthResult {
  token: string;
  expiresAt: number;
}

export async function createToken(user: User): Promise<string> {
  return sign({ id: user.id }, process.env.SECRET!);
}

export function verifyToken(token: string): User | null {
  try {
    return verify(token, process.env.SECRET!) as User;
  } catch {
    return null;
  }
}

export class AuthService {
  constructor(private secret: string) {}
}
`;

  it("extracts imports", () => {
    const parsed = parseCode(tsCode, "typescript");
    expect(parsed.imports.length).toBeGreaterThan(0);
    const jwtImport = parsed.imports.find((i) => i.source === "jsonwebtoken");
    expect(jwtImport).toBeDefined();
    expect(jwtImport?.specifiers).toContain("sign");
  });

  it("extracts exports", () => {
    const parsed = parseCode(tsCode, "typescript");
    expect(parsed.exports).toContain("createToken");
    expect(parsed.exports).toContain("verifyToken");
    expect(parsed.exports).toContain("AuthService");
    expect(parsed.exports).toContain("AuthResult");
  });

  it("extracts functions", () => {
    const parsed = parseCode(tsCode, "typescript");
    const fns = parsed.symbols.filter((s) => s.kind === "function");
    expect(fns.length).toBeGreaterThanOrEqual(2);
    const createFn = fns.find((f) => f.name === "createToken");
    expect(createFn).toBeDefined();
    expect(createFn?.async).toBe(true);
    expect(createFn?.exported).toBe(true);
  });

  it("extracts classes", () => {
    const parsed = parseCode(tsCode, "typescript");
    const classes = parsed.symbols.filter((s) => s.kind === "class");
    expect(classes.length).toBeGreaterThanOrEqual(1);
    expect(classes[0]?.name).toBe("AuthService");
  });

  it("extracts interface", () => {
    const parsed = parseCode(tsCode, "typescript");
    const ifaces = parsed.symbols.filter((s) => s.kind === "interface");
    expect(ifaces.length).toBeGreaterThanOrEqual(1);
    expect(ifaces[0]?.name).toBe("AuthResult");
  });

  it("extracts top-level comments", () => {
    const parsed = parseCode(tsCode, "typescript");
    expect(parsed.topLevelComments.length).toBeGreaterThan(0);
    expect(parsed.topLevelComments[0]).toContain("Authentication");
  });
});

describe("parseCode - Python", () => {
  const pyCode = `
"""Authentication utilities for the API."""

from typing import Optional
from datetime import datetime
import hashlib

def create_token(user_id: str) -> str:
    return hashlib.sha256(user_id.encode()).hexdigest()

async def verify_token(token: str) -> Optional[str]:
    return None

class AuthManager:
    def __init__(self, secret: str):
        self.secret = secret

def _internal_helper():
    pass
`;

  it("extracts Python imports", () => {
    const parsed = parseCode(pyCode, "python");
    expect(parsed.imports.length).toBeGreaterThan(0);
  });

  it("extracts Python functions (public)", () => {
    const parsed = parseCode(pyCode, "python");
    const fns = parsed.symbols.filter((s) => s.kind === "function" && s.exported);
    expect(fns.map((f) => f.name)).toContain("create_token");
    expect(fns.map((f) => f.name)).toContain("verify_token");
  });

  it("does not export private functions", () => {
    const parsed = parseCode(pyCode, "python");
    const privateFn = parsed.symbols.find((s) => s.name === "_internal_helper");
    expect(privateFn?.exported).toBe(false);
  });
});

describe("inferPurpose", () => {
  it("uses top-level comment when available", () => {
    const symbols: Parameters<typeof inferPurpose>[1] = [];
    const imports: Parameters<typeof inferPurpose>[2] = [];
    const comments = ["Authentication service for JWT tokens."];
    const purpose = inferPurpose("auth.ts", symbols, imports, comments);
    expect(purpose).toBe("Authentication service for JWT tokens.");
  });

  it("infers from filename patterns", () => {
    const purpose = inferPurpose("src/server/index.ts", [], [], []);
    expect(purpose).toBeTruthy();
    expect(purpose.length).toBeGreaterThan(5);
  });

  it("infers from class name", () => {
    const symbols: Parameters<typeof inferPurpose>[1] = [
      { name: "TokenCounter", kind: "class", exported: true },
    ];
    const purpose = inferPurpose("counter.ts", symbols, [], []);
    expect(purpose).toContain("TokenCounter");
  });
});

// ── Tree-sitter specific tests ────────────────────────────────────────────

const tsAvailable = isTreeSitterAvailable();

describe.skipIf(!tsAvailable)("parseCode - Tree-sitter multiline & generics (TypeScript)", () => {
  const multilineCode = `
/**
 * Generic data store for type-safe access.
 */
import { EventEmitter } from 'events';
import type { Readable } from 'stream';

export type Result<T, E extends Error = Error> = { ok: true; value: T } | { ok: false; error: E };

export interface Repository<T extends { id: string }> {
  findById(id: string): Promise<T | null>;
  save(entity: T): Promise<void>;
}

export async function fetchWithRetry<T>(
  url: string,
  retries: number = 3,
): Promise<Result<T>> {
  throw new Error('not implemented');
}

export const identity = <T>(x: T): T => x;

export enum Status {
  Pending = 'pending',
  Active = 'active',
  Closed = 'closed',
}

export abstract class BaseRepository<T extends { id: string }> implements Repository<T> {
  protected cache = new Map<string, T>();

  async findById(id: string): Promise<T | null> {
    return this.cache.get(id) ?? null;
  }

  abstract save(entity: T): Promise<void>;
}
`;

  it("extracts multiline generic function", () => {
    const parsed = parseCode(multilineCode, "typescript");
    const fn = parsed.symbols.find((s) => s.name === "fetchWithRetry");
    expect(fn).toBeDefined();
    expect(fn?.kind).toBe("function");
    expect(fn?.async).toBe(true);
    expect(fn?.exported).toBe(true);
    expect(fn?.lineStart).toBeGreaterThan(0);
    expect(fn?.lineEnd).toBeGreaterThan(fn?.lineStart ?? 0);
  });

  it("extracts generic interface", () => {
    const parsed = parseCode(multilineCode, "typescript");
    const iface = parsed.symbols.find((s) => s.name === "Repository");
    expect(iface).toBeDefined();
    expect(iface?.kind).toBe("interface");
  });

  it("extracts generic type alias", () => {
    const parsed = parseCode(multilineCode, "typescript");
    const t = parsed.symbols.find((s) => s.name === "Result");
    expect(t).toBeDefined();
    expect(t?.kind).toBe("type");
  });

  it("extracts enum", () => {
    const parsed = parseCode(multilineCode, "typescript");
    const e = parsed.symbols.find((s) => s.name === "Status");
    expect(e).toBeDefined();
    expect(e?.kind).toBe("enum");
  });

  it("extracts abstract class", () => {
    const parsed = parseCode(multilineCode, "typescript");
    const cls = parsed.symbols.find((s) => s.name === "BaseRepository");
    expect(cls).toBeDefined();
    expect(cls?.kind).toBe("class");
  });

  it("extracts methods from abstract class", () => {
    const parsed = parseCode(multilineCode, "typescript");
    const methods = parsed.symbols.filter((s) => s.kind === "method");
    expect(methods.some((m) => m.name === "findById")).toBe(true);
  });

  it("populates lineEnd", () => {
    const parsed = parseCode(multilineCode, "typescript");
    const fn = parsed.symbols.find((s) => s.name === "fetchWithRetry");
    expect(fn?.lineEnd).toBeDefined();
  });
});

describe.skipIf(!tsAvailable)("parseCode - Tree-sitter decorators (TypeScript)", () => {
  const decoratorCode = `
import { Injectable, Get, Controller } from '@nestjs/common';

@Injectable()
export class UserService {
  @Get('/users')
  async getUsers(): Promise<string[]> {
    return [];
  }
}

@Controller('/api')
export class ApiController {
  constructor(private readonly userService: UserService) {}
}
`;

  it("extracts decorated class", () => {
    const parsed = parseCode(decoratorCode, "typescript");
    expect(parsed.symbols.find((s) => s.name === "UserService")).toBeDefined();
    expect(parsed.symbols.find((s) => s.name === "ApiController")).toBeDefined();
  });

  it("extracts methods inside decorated class", () => {
    const parsed = parseCode(decoratorCode, "typescript");
    const methods = parsed.symbols.filter((s) => s.kind === "method");
    expect(methods.some((m) => m.name === "getUsers")).toBe(true);
  });
});

describe.skipIf(!tsAvailable)("parseCode - Tree-sitter React components (TypeScript)", () => {
  const reactCode = `
import React, { useState, useEffect } from 'react';
import type { FC } from 'react';

interface ButtonProps {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}

export const Button: FC<ButtonProps> = ({ label, onClick, disabled = false }) => {
  return <button onClick={onClick} disabled={disabled}>{label}</button>;
};

export function useCounter(initial: number = 0) {
  const [count, setCount] = useState(initial);
  useEffect(() => { /* side effect */ }, [count]);
  return { count, increment: () => setCount((c) => c + 1) };
}

export default function App() {
  return <div><Button label="Click me" /></div>;
}
`;

  it("extracts React component (const arrow)", () => {
    const parsed = parseCode(reactCode, "typescript");
    const btn = parsed.symbols.find((s) => s.name === "Button");
    expect(btn).toBeDefined();
    expect(btn?.exported).toBe(true);
  });

  it("extracts custom hook", () => {
    const parsed = parseCode(reactCode, "typescript");
    const hook = parsed.symbols.find((s) => s.name === "useCounter");
    expect(hook).toBeDefined();
    expect(hook?.kind).toBe("function");
  });

  it("detects default export", () => {
    const parsed = parseCode(reactCode, "typescript");
    expect(parsed.hasDefaultExport).toBe(true);
  });
});

describe.skipIf(!tsAvailable)("parseCode - Tree-sitter Rust traits & structs", () => {
  const rustCode = `
use std::collections::HashMap;
use serde::{Serialize, Deserialize};

/// A user record in the system.
#[derive(Debug, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub name: String,
    email: String,
}

pub trait Repository<T> {
    fn find_by_id(&self, id: &str) -> Option<T>;
    fn save(&mut self, entity: T) -> Result<(), String>;
}

pub enum UserStatus {
    Active,
    Suspended,
    Deleted,
}

impl User {
    pub fn new(id: String, name: String, email: String) -> Self {
        User { id, name, email }
    }

    pub async fn fetch_remote(id: &str) -> Result<User, String> {
        Err("not implemented".to_string())
    }
}

fn internal_helper(x: i32) -> i32 {
    x * 2
}
`;

  it("extracts pub struct", () => {
    const parsed = parseCode(rustCode, "rust");
    const s = parsed.symbols.find((s) => s.name === "User");
    expect(s).toBeDefined();
    expect(s?.kind).toBe("struct");
    expect(s?.exported).toBe(true);
  });

  it("extracts pub trait", () => {
    const parsed = parseCode(rustCode, "rust");
    const t = parsed.symbols.find((s) => s.name === "Repository");
    expect(t).toBeDefined();
    expect(t?.kind).toBe("trait");
    expect(t?.exported).toBe(true);
  });

  it("extracts pub enum", () => {
    const parsed = parseCode(rustCode, "rust");
    const e = parsed.symbols.find((s) => s.name === "UserStatus");
    expect(e).toBeDefined();
    expect(e?.kind).toBe("enum");
  });

  it("extracts impl methods as kind=method", () => {
    const parsed = parseCode(rustCode, "rust");
    const methods = parsed.symbols.filter((s) => s.kind === "method");
    expect(methods.some((m) => m.name === "new")).toBe(true);
  });

  it("marks private fn as not exported", () => {
    const parsed = parseCode(rustCode, "rust");
    const helper = parsed.symbols.find((s) => s.name === "internal_helper");
    expect(helper?.exported).toBe(false);
  });

  it("extracts use imports", () => {
    const parsed = parseCode(rustCode, "rust");
    expect(parsed.imports.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!tsAvailable)("parseCode - Tree-sitter Go methods", () => {
  const goCode = `
package main

import (
  "fmt"
  "net/http"
)

// Server handles HTTP requests.
type Server struct {
  host string
  port int
}

// NewServer creates a new Server.
func NewServer(host string, port int) *Server {
  return &Server{host: host, port: port}
}

func (s *Server) Start() error {
  return http.ListenAndServe(fmt.Sprintf("%s:%d", s.host, s.port), nil)
}

func (s *Server) stop() {
  // unexported method
}

type Handler interface {
  ServeHTTP(w http.ResponseWriter, r *http.Request)
}
`;

  it("extracts exported function", () => {
    const parsed = parseCode(goCode, "go");
    const fn = parsed.symbols.find((s) => s.name === "NewServer");
    expect(fn).toBeDefined();
    expect(fn?.kind).toBe("function");
    expect(fn?.exported).toBe(true);
  });

  it("extracts exported method", () => {
    const parsed = parseCode(goCode, "go");
    const m = parsed.symbols.find((s) => s.name === "Start");
    expect(m).toBeDefined();
    expect(m?.kind).toBe("method");
    expect(m?.exported).toBe(true);
  });

  it("marks unexported method correctly", () => {
    const parsed = parseCode(goCode, "go");
    const m = parsed.symbols.find((s) => s.name === "stop");
    expect(m?.exported).toBe(false);
  });

  it("extracts struct type", () => {
    const parsed = parseCode(goCode, "go");
    const s = parsed.symbols.find((s) => s.name === "Server");
    expect(s?.kind).toBe("struct");
  });

  it("extracts interface type", () => {
    const parsed = parseCode(goCode, "go");
    const iface = parsed.symbols.find((s) => s.name === "Handler");
    expect(iface?.kind).toBe("interface");
  });

  it("extracts grouped imports", () => {
    const parsed = parseCode(goCode, "go");
    expect(parsed.imports.length).toBeGreaterThanOrEqual(2);
  });
});

describe.skipIf(!tsAvailable)("parseCode - Tree-sitter Python async & decorators", () => {
  const pyCode = `
"""Auth utilities for the API."""

from typing import Optional, Callable
from functools import wraps
import hashlib

__all__ = ['create_token', 'require_auth', 'AuthManager']

def create_token(user_id: str) -> str:
    return hashlib.sha256(user_id.encode()).hexdigest()

async def verify_token(token: str) -> Optional[str]:
    return None

def require_auth(func: Callable) -> Callable:
    @wraps(func)
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs)
    return wrapper

class AuthManager:
    def __init__(self, secret: str):
        self.secret = secret

    async def validate(self, token: str) -> bool:
        return False

def _internal() -> None:
    pass
`;

  it("respects __all__ for export filtering", () => {
    const parsed = parseCode(pyCode, "python");
    expect(parsed.exports).toContain("create_token");
    expect(parsed.exports).toContain("AuthManager");
    // _internal not in __all__
    const internal = parsed.symbols.find((s) => s.name === "_internal");
    expect(internal?.exported).toBe(false);
  });

  it("marks async function correctly", () => {
    const parsed = parseCode(pyCode, "python");
    const fn = parsed.symbols.find((s) => s.name === "verify_token");
    expect(fn?.async).toBe(true);
  });

  it("extracts module docstring as topLevelComment", () => {
    const parsed = parseCode(pyCode, "python");
    expect(parsed.topLevelComments.length).toBeGreaterThan(0);
    expect(parsed.topLevelComments[0]).toContain("Auth");
  });

  it("extracts class", () => {
    const parsed = parseCode(pyCode, "python");
    const cls = parsed.symbols.find((s) => s.name === "AuthManager");
    expect(cls?.kind).toBe("class");
  });
});

describe.skipIf(!tsAvailable)("parseCode - Tree-sitter fallback behavior", () => {
  it("parseCode still works correctly when tree-sitter is available", () => {
    const code = `export function hello(name: string): string { return \`Hello \${name}\`; }`;
    const parsed = parseCode(code, "typescript");
    expect(parsed.symbols.find((s) => s.name === "hello")).toBeDefined();
    expect(parsed.language).toBe("typescript");
  });

  it("tree-sitter returns null for unknown language", () => {
    const result = parseWithTreeSitter("some content", "unknown");
    expect(result).toBeNull();
  });
});
