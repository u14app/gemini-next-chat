import dynamic from 'next/dynamic'
import { useMemo, memo } from 'react'
import Markdown, { type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { clsx } from 'clsx'
import { omit } from 'lodash-es'

import './style.css'
import 'katex/dist/katex.min.css'

const Code = dynamic(() => import('./Code'))
const Mermaid = dynamic(() => import('./Mermaid'))

function Magicdown({ children: content, className, ...rest }: Options) {
  const remarkPlugins = useMemo(() => rest.remarkPlugins ?? [], [rest.remarkPlugins])
  const rehypePlugins = useMemo(() => rest.rehypePlugins ?? [], [rest.rehypePlugins])
  const components = useMemo(() => rest.components ?? {}, [rest.components])

  return (
    <Markdown
      {...rest}
      className={clsx('markdown', className)}
      remarkPlugins={[remarkGfm, remarkMath, ...remarkPlugins]}
      rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }], rehypeKatex, ...rehypePlugins]}
      components={{
        pre: (props) => {
          const { children, className, ...rest } = props
          return (
            <pre {...omit(rest, ['node'])} className={clsx('my-4', className)}>
              {children}
            </pre>
          )
        },
        code: (props) => {
          const { children, className, node, ...rest } = props
          if (className?.includes('hljs')) {
            const lang = /language-(\w+)/.exec(className || '')
            if (lang && lang[1] === 'mermaid') {
              return <Mermaid>{children}</Mermaid>
            }
            return (
              <Code lang={lang ? lang[1] : ''}>
                <code {...rest} className={clsx('break-all', className)}>
                  {children}
                </code>
              </Code>
            )
          } else {
            return (
              <code {...rest} className={clsx('break-all', className)}>
                {children}
              </code>
            )
          }
        },
        a: (props) => {
          const { children, className, href = '', target, ...rest } = props
          if (/\.(aac|mp3|opus|wav)$/.test(href)) {
            return (
              <figure>
                <audio controls src={href}></audio>
              </figure>
            )
          }
          if (/\.(3gp|3g2|webm|ogv|mpeg|mp4|avi)$/.test(href)) {
            return (
              <video controls width="99.9%">
                <source src={href} />
              </video>
            )
          }
          const isInternal = /^\/#/i.test(href)
          return (
            <a
              {...omit(rest, ['node'])}
              className={clsx('break-all', className)}
              href={href}
              target={isInternal ? '_self' : target ?? '_blank'}
            >
              {children}
            </a>
          )
        },
        img: (props) => {
          const { ...rest } = props
          // eslint-disable-next-line
          return <img loading="lazy" {...omit(rest, ['node'])} />
        },
        ...components,
      }}
      urlTransform={(value: string) => value}
    >
      {content}
    </Markdown>
  )
}

export default memo(Magicdown)
