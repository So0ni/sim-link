import { ArrowLeft } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

export function BackLink({href,children}:{href:string;children:ReactNode}) {
  return <a className="back-link" href={href}><ArrowLeft size={20} aria-hidden="true"/>{children}</a>;
}
