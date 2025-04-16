import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Edge-safe logging function
const logInfo = (message: string) => {
  console.log(`[Edge] ${new Date().toISOString()} - ${message}`);
};

// This middleware ensures API routes are not protected by authentication
export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  
  // Only process API routes
  if (path.startsWith('/api')) {
    logInfo(`API middleware active: ${path}`);
    
    // Clone the headers
    const requestHeaders = new Headers(request.headers);
    
    // Remove any authentication headers that might be causing issues
    requestHeaders.delete('authorization');
    requestHeaders.delete('Authorization');
    
    // Create a new response with modified headers
    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
    
    return response;
  }
  
  // For non-API routes, just pass through
  return NextResponse.next();
}

// Change matcher to INCLUDE API routes specifically
export const config = {
  matcher: ['/api/:path*'],
}; 