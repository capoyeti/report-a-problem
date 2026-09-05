import { type ReactNode } from 'react';
import { type ReportProblemPanelProps } from './ReportProblemPanel.js';
interface Ctx {
    open: () => void;
    close: () => void;
    isOpen: boolean;
    enabled: boolean;
}
/** Owns open/close state and mounts the panel once. `enabled` is whatever the consumer decides (flag, role, env). */
export declare function ReportProblemProvider({ enabled, endpoints, children }: {
    enabled?: boolean;
    endpoints?: ReportProblemPanelProps['endpoints'];
    children: ReactNode;
}): import("react").JSX.Element;
export declare function useReportProblem(): Ctx;
export {};
