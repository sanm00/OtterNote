import React from 'react';

/** Planning page shell: title block + centred design column, per product-plan-demo. */
export function Page({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="app-page flex min-h-0 flex-1 flex-col">
      <header className="app-page-header shrink-0 border-b px-7 py-4">
        <div className="ds-view ds-view-head">
          <div className="min-w-0">
            <h1 className="ds-title">{title}</h1>
            {subtitle ? <p className="ds-sub">{subtitle}</p> : null}
          </div>
          {actions}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-16 pt-5">
        <div className="ds-view space-y-4">{children}</div>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="app-page-header border-b px-7 py-4">
      {children ?? <h1 className="ds-title">{title}</h1>}
      {subtitle ? <p className="ds-sub">{subtitle}</p> : null}
    </header>
  );
}

export function EmptyMessage({
  title,
  message,
  icon,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state px-4 py-8 text-center">
      <div className="empty-state-icon mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg">
        {typeof icon === 'string' ? (
          <span aria-hidden="true" className="text-[18px] leading-none">
            {icon}
          </span>
        ) : (
          icon
        )}
      </div>
      <div className="ds-text text-[13px] font-semibold">{title}</div>
      <div className="ds-muted mt-1 text-[12.5px]">{message}</div>
      {actionLabel && onAction ? (
        <button type="button" className="ds-primary mt-5" onClick={onAction}>
          <span aria-hidden="true">＋</span>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
