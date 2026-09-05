// The harness loads React as a UMD global; this re-exports it as an ES module so
// the built package's bare `react` imports resolve through the import map.
const React = window.React;
export default React;
export const {
  createContext, createElement, forwardRef, Fragment,
  useCallback, useContext, useEffect, useMemo, useRef, useState,
} = React;
