import { createRef } from 'react'

/**
 * Stable DOM container for drei <Html> labels. Without an explicit portal, <Html>'s target
 * switches from the canvas parent to the R3F event container after mount, which re-creates
 * its React root mid-render and can leave a label empty.
 */
export const labelLayer = createRef<HTMLDivElement>()
