import { type ReactNode } from 'react';
import { type ReportProblemPanelProps } from './ReportProblemPanel.js';
interface Ctx {
    open: () => void;
    close: () => void;
    isOpen: boolean;
    enabled: boolean;
}
/**
 * Owns the open/close state and mounts the panel exactly once, so a trigger
 * anywhere in the tree is a hook call rather than another copy of the same forty
 * lines of state. `enabled` is whatever the consumer decides (a flag, a role, an
 * environment check); when false the panel is not rendered at all, so its
 * html2canvas import never loads.
 */
export declare function ReportProblemProvider({ enabled, endpoints, children }: {
    enabled?: boolean;
    endpoints?: ReportProblemPanelProps['endpoints'];
    children: ReactNode;
}): import("react").JSX.Element;
/**
 * Reads the panel controls from context. Outside a provider it returns an inert
 * context with `enabled: false` rather than throwing, so a shared header
 * component carrying a "Report a problem" item can render in an app that has not
 * adopted the package.
 */
export declare function useReportProblem(): Ctx;
export {};
