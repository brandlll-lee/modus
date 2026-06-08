import type { CSSProperties } from "react";
import { cn } from "../../lib/cn";

type BorderBeamProps = {
  /** 彗星光束的尺寸（px），越大扫过的高光越长。 */
  size?: number;
  /** 绕行一圈的时长（秒）。 */
  duration?: number;
  /** 起始延迟（秒），用于多道光束错相位。 */
  delay?: number;
  /** 渐变头色（亮核）。默认品牌紫。 */
  colorFrom?: string;
  /** 渐变尾色，淡出到透明。 */
  colorTo?: string;
  /** 是否反向绕行。 */
  reverse?: boolean;
  /** 描边宽度（px）。 */
  borderWidth?: number;
  /** 附加在彗星元素上的类名。 */
  className?: string;
};

/**
 * Border Beam —— 沿容器边框绕行的光束动画（Magic UI 同款视觉）。
 *
 * 与官方实现的差异：官方用 motion 的 JS 逐帧驱动 `offsetDistance`，该属性不走
 * 合成器加速、主线程繁忙时会掉帧。本实现保留完全一致的视觉技术（mask 边框环 +
 * offset-path 彗星），但改用纯 CSS @keyframes 驱动，零 JS 开销、调度更稳。
 *
 * 用法：父容器需 `position: relative`，本组件以 `absolute inset-0` 覆盖并继承圆角。
 */
export function BorderBeam({
  size = 90,
  duration = 5,
  delay = 0,
  colorFrom = "#853ff4",
  colorTo = "#b388ff",
  reverse = false,
  borderWidth = 1.5,
  className,
}: BorderBeamProps) {
  return (
    <div
      aria-hidden
      className="modus-border-beam-ring pointer-events-none absolute inset-0 rounded-[inherit]"
      style={{ "--mbb-border-width": `${borderWidth}px` } as CSSProperties}
    >
      <div
        className={cn("modus-border-beam-comet", className)}
        style={
          {
            width: size,
            offsetPath: `rect(0 auto auto 0 round ${size}px)`,
            background: `linear-gradient(to left, ${colorFrom}, ${colorTo}, transparent)`,
            animationDirection: reverse ? "reverse" : "normal",
            animationDelay: `${-delay}s`,
            "--mbb-duration": `${duration}s`,
          } as CSSProperties
        }
      />
    </div>
  );
}
