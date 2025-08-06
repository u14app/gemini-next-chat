'use client'
import { memo, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/utils'

type Props = {
  open: boolean
  onClose: () => void
  className?: string
  title: string | ReactNode
  description?: string | ReactNode
  trigger?: ReactNode
  children: ReactNode
  footer?: ReactNode
}

function DrawerDialog(props: Props) {
  const { open, onClose, className, title, description, trigger, children, footer } = props
  const isMobile = useIsMobile(450)

  const handleClose = (open: boolean) => {
    if (!open) onClose()
  }

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleClose}>
        {trigger ? <DrawerTrigger asChild>{trigger}</DrawerTrigger> : null}
        <DrawerContent className={className}>
          <DrawerHeader className="text-left">
            {title ? <DrawerTitle>{title}</DrawerTitle> : null}
            {description ? <DrawerDescription>{description}</DrawerDescription> : null}
          </DrawerHeader>
          <div className="h-full w-full overflow-hidden px-4">{children}</div>
          {footer ? <DrawerFooter className="pt-2">{footer}</DrawerFooter> : null}
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className={cn('overflow-y-auto landscape:max-md:h-4/5', className)}>
        <DialogHeader>
          {title ? <DialogTitle>{title}</DialogTitle> : null}
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div>{children}</div>
        {footer ? <DialogFooter className="mx-auto w-4/5 gap-2 sm:justify-center">{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  )
}

export default memo(DrawerDialog)
