import { b } from '@ultime/b'
import { c } from '@ultime/c'
import { z } from '@ultime/c/src/z'
import { local } from './local'
import { localJs } from './local.js'
import { dir } from './dir'
import { escaped } from '../../../packages/c/src/z.ts'

export const values = [b, c, z, local, localJs, dir, escaped]
