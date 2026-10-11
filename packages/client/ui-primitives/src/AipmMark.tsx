import type { IconProps } from './icons/props.ts'

/**
 * The workbench's three-blob mark, served from the web app's public folder.
 * @param props - Icon size and optional layout class.
 * @returns An aria-hidden mark; the adjacent wordmark supplies the name.
 */
export function AipmMark({ size = 24, className }: IconProps) {
  return <img src="/workbench-mark.png" width={size} height={size} className={className} alt="" aria-hidden="true" draggable={false} style={{ objectFit: 'contain' }} />
}
