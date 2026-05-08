/** In-memory JWT — never persist to localStorage / sessionStorage */
let memoryAccessToken: string | null = null

export function getMemoryAccessToken(): string | null {
  return memoryAccessToken
}

export function setMemoryAccessToken(token: string | null): void {
  memoryAccessToken = token
}
