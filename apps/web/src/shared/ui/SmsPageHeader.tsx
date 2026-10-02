import type { ReactNode } from 'react';
import { PageBrand } from './PageBrand.tsx';

export function SmsPageHeader({action}:{action?:ReactNode}) {
  return <header className="sms-page-header"><PageBrand/><div className="title-row"><h1>短信</h1>{action}</div></header>;
}
