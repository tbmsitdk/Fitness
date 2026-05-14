import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-muted-foreground border-border',
        run: 'border-transparent bg-blue-500/10 text-blue-400',
        cycle: 'border-transparent bg-green-500/10 text-green-400',
        walk: 'border-transparent bg-amber-500/10 text-amber-400',
        fresh: 'border-transparent bg-green-500/10 text-green-400',
        fatigued: 'border-transparent bg-red-500/10 text-red-400',
        neutral: 'border-transparent bg-amber-500/10 text-amber-400',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
