import type { SVGProps } from 'react'
import { Settings } from 'lucide-react'

/** Thin-line icons in lucide's style for the website's trade cards that lucide has no match for. */
type IconProps = SVGProps<SVGSVGElement>

function Svg({ strokeWidth = 2, children, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  )
}

/** Pointed plastering trowel: handle top right, blade tip bottom left. */
export function Trowel(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.62 7.62 19.62 2.62a1.25 1.25 0 0 1 1.76 1.76l-5 5Z" />
      <path d="M15.5 8.5 11.5 12.5" />
      <path d="M3 21q2-8 6.4-10.6l4.2 4.2Q11 19 3 21Z" />
    </Svg>
  )
}

/** Tradesperson in a hard hat. */
export function Worker(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.5 9V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v6" />
      <path d="M13.5 4a5 5 0 0 1 5 5" />
      <path d="M5.5 9a5 5 0 0 1 5-5" />
      <rect x="4" y="9" width="16" height="2" rx="1" />
      <path d="M8.5 11v.5a3.5 3.5 0 0 0 7 0V11" />
      <path d="M5 21v-.5A3.5 3.5 0 0 1 8.5 17h7a3.5 3.5 0 0 1 3.5 3.5v.5" />
      <path d="m10 17 2 2 2-2" />
    </Svg>
  )
}

/**
 * Two meshing gears built from lucide's Settings cog. `absoluteStrokeWidth` keeps both gears' lines as thick as
 * the outer icon's, and the small gear is turned 30° so a tooth of the big one sits in its gap.
 */
export function TwinGears({ strokeWidth = 2, ...props }: IconProps) {
  const sw = Number(strokeWidth)
  return (
    <Svg strokeWidth={sw} {...props}>
      <Settings x={0.88} y={2.68} size={15} strokeWidth={sw} absoluteStrokeWidth />
      <g transform="rotate(30 16.87 15.08)">
        <Settings x={10.87} y={9.08} size={12} strokeWidth={sw} absoluteStrokeWidth />
      </g>
    </Svg>
  )
}
