import { type ReactNode } from 'react';
import { type ReportProblemPanelProps } from './ReportProblemPanel.js';
interface Ctx {
    open: () => void;
    close: () => void;
    isOpen: boolean;
    enabled: boolean;
}
export interface ReportProblemProviderProps {
    enabled?: boolean;
    endpoints?: ReportProblemPanelProps['endpoints'];
    availability?: ReportProblemPanelProps['availability'];
    children: ReactNode;
}
export declare function ReportProblemProvider({ enabled, endpoints, availability, children }: ReportProblemProviderProps): import("react").JSX.Element;
/**
 * Reads the panel controls from context. Outside a provider it returns an inert
 * context with `enabled: false` rather than throwing, so a shared header
 * component carrying a "Report a problem" item can render in an app that has not
 * adopted the package.
 */
export declare function useReportProblem(): Ctx;
export {};
