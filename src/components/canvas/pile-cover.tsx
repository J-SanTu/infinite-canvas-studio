import { useId } from "react";

/** Geometry from the supplied 207×174 SVG; the front card occupies 150×150.
 * The design repeats the cover photograph on all five cards, not blank panels.
 */
export function PileCover({ src, title, radius, onError }: { src: string; title: string; radius: number; onError: () => void }) {
    const id = useId().replace(/:/g, "");
    const layers = [
        { transform: "translate(31.0471 0) rotate(10)", opacity: 0.2, blur: true },
        { transform: "translate(-28 26.0472) rotate(-10)", opacity: 0.2, blur: true },
        { transform: "translate(16.0732 0) rotate(5)", opacity: 0.6, blur: false },
        { transform: "translate(-14.7342 13.0734) rotate(-5)", opacity: 0.6, blur: false },
        { transform: "", opacity: 1, blur: false },
    ];
    return (
        <svg aria-label={title} role="img" viewBox="0 0 150 150" className="pointer-events-none block h-full w-full overflow-visible" data-pile-cover="svg-v1">
            <defs>
                <clipPath id={`${id}-card`}><rect width="150" height="150" rx={radius} /></clipPath>
                <filter id={`${id}-soft`} x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="0.35" /></filter>
            </defs>
            {layers.map((layer, index) => (
                <g key={index} transform={layer.transform} opacity={layer.opacity} filter={layer.blur ? `url(#${id}-soft)` : undefined}>
                    <g clipPath={`url(#${id}-card)`}>
                        <rect width="150" height="150" fill="white" />
                        <image href={src} width="150" height="150" preserveAspectRatio="xMidYMid meet" onError={index === 4 ? onError : undefined} />
                    </g>
                </g>
            ))}
        </svg>
    );
}
