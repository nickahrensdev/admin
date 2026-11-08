/** Small stroke icons used in the tab bar and lists. Decorative: always aria-hidden. */
type Props = { size?: number };

function Svg({ size = 22, children }: Props & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const HomeIcon = (p: Props) => <Svg {...p}><path d="M3 11l9-8 9 8v10h-6v-7H9v7H3z" /></Svg>;
export const BookIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M3 10h18M12 13v5M9.5 15.5h5" />
  </Svg>
);
export const ListIcon = (p: Props) => <Svg {...p}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></Svg>;
export const StarIcon = (p: Props) => <Svg {...p}><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" /></Svg>;
export const PersonIcon = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
  </Svg>
);
export const DeskIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M9 11l3 3 8-8" />
    <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />
  </Svg>
);
export const CalendarIcon = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M3 10h18" />
  </Svg>
);
export const PinIcon = (p: Props) => (
  <Svg {...p}>
    <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
    <circle cx="12" cy="10" r="2.5" />
  </Svg>
);
export const ChevronRight = (p: Props) => <Svg size={16} {...p}><path d="M9 6l6 6-6 6" /></Svg>;
export const ChevronLeft = (p: Props) => <Svg {...p}><path d="M15 6l-6 6 6 6" /></Svg>;
export const PlusIcon = (p: Props) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const CheckIcon = (p: Props) => <Svg {...p}><path d="M5 12l5 5 9-10" /></Svg>;
export const MegaphoneIcon = (p: Props) => <Svg {...p}><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1zM16 9a4 4 0 0 1 0 6" /></Svg>;
export const RepeatIcon = (p: Props) => <Svg {...p}><path d="M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3" /></Svg>;
