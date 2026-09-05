export interface ReportProblemPanelProps {
    open: boolean;
    onClose: () => void;
    endpoints?: {
        report?: string;
        attachment?: string;
    };
}
/**
 * Proactive "Report a problem" panel. Unlike a reactive error toast (which only
 * appears when code catches an error), this lets a signed-in user describe a
 * problem at any time. The description is POSTed to the consumer's own route,
 * which forwards it to error-triage-service. No technical detail is ever shown
 * to the user, and we only render copy we control here.
 *
 * A non-blocking, draggable floating panel rather than a modal: the page stays
 * fully interactive behind it so the reporter can navigate, reproduce the
 * problem, and take further OS-level screenshots (pasted in here) while it is
 * still open, all landing in one report on a single Send.
 *
 * Controlled component: parent owns `open` and resets on `onClose`.
 */
export declare function ReportProblemPanel({ open, onClose, endpoints }: ReportProblemPanelProps): import("react").JSX.Element | null;
export default ReportProblemPanel;
