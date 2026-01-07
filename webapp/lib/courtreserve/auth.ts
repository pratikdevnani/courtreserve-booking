/**
 * Cookie and session management for CourtReserve API
 */

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
}

export class CookieManager {
  private cookies: Map<string, Cookie> = new Map();

  /**
   * Parse Set-Cookie headers from a response
   */
  parseSetCookies(headers: Headers): void {
    const setCookieHeaders = headers.getSetCookie();

    for (const setCookie of setCookieHeaders) {
      const cookie = this.parseCookieString(setCookie);
      if (cookie) {
        this.cookies.set(cookie.name, cookie);
      }
    }
  }

  /**
   * Parse a single Set-Cookie string
   */
  private parseCookieString(setCookie: string): Cookie | null {
    const parts = setCookie.split(';').map(p => p.trim());
    if (parts.length === 0) return null;

    const [nameValue] = parts;
    const [name, value] = nameValue.split('=');
    if (!name || value === undefined) return null;

    const cookie: Cookie = { name, value };

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const [key, val] = part.split('=');

      switch (key.toLowerCase()) {
        case 'domain':
          cookie.domain = val;
          break;
        case 'path':
          cookie.path = val;
          break;
        case 'expires':
          cookie.expires = new Date(val);
          break;
        case 'httponly':
          cookie.httpOnly = true;
          break;
        case 'secure':
          cookie.secure = true;
          break;
      }
    }

    return cookie;
  }

  /**
   * Serialize cookies to a Cookie header string
   */
  serializeCookies(): string {
    return Array.from(this.cookies.values())
      .filter(cookie => {
        // Filter out expired cookies
        if (cookie.expires && cookie.expires < new Date()) {
          return false;
        }
        return true;
      })
      .map(cookie => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }

  /**
   * Get a specific cookie by name
   */
  getCookie(name: string): Cookie | undefined {
    return this.cookies.get(name);
  }

  /**
   * Set a cookie manually
   */
  setCookie(cookie: Cookie): void {
    this.cookies.set(cookie.name, cookie);
  }

  /**
   * Clear all cookies
   */
  clear(): void {
    this.cookies.clear();
  }

  /**
   * Check if we have any cookies
   */
  hasCookies(): boolean {
    return this.cookies.size > 0;
  }

  /**
   * Get all cookies
   */
  getAllCookies(): Cookie[] {
    return Array.from(this.cookies.values());
  }
}
