/**
 * The icons the interface uses, in one place so the bundle contains only these. They are lucide
 * outlines (ISC licence, inline SVG, no network). Lucide marks an icon `aria-hidden` unless it is
 * given a label, so every icon here is decoration and the control around it carries the name.
 */
export {
  ArrowUp,
  AudioLines,
  Bell,
  ChevronDown,
  ChevronsUpDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  Clock,
  Command,
  FileText,
  Folder,
  FolderOpen,
  Info,
  Loader,
  LogIn,
  LogOut,
  Menu,
  Mic,
  MicOff,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  Settings,
  Square,
  Trash2,
  TriangleAlert,
  User,
  X,
} from "lucide-react";

import type { SVGProps } from "react";

/** NoteBridge's mark: a rounded square holding a small arch (the bridge) over two lines of notes. */
export function LogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect x="2.75" y="2.75" width="18.5" height="18.5" rx="5" />
      <path d="M6.5 13.5c1.2-3.6 3.2-5.2 5.5-5.2s4.3 1.6 5.5 5.2" />
      <path d="M7 16.5h10" />
    </svg>
  );
}
