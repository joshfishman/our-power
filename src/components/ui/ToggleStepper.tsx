import { cn } from '@/lib/cn';
import { SVGProps, useRef } from 'react';
import { VariantProps, cva } from 'class-variance-authority';
import { AriaToggleButtonProps, mergeProps, useFocusRing, useToggleButton } from 'react-aria';
import { useToggleState } from 'react-stately';

const toggle = cva('flex cursor-pointer select-none items-center gap-3 rounded-full px-4 py-2 active:ring-4', {
  variants: {
    color: {
      red: 'hover:bg-destructive-foreground/30 focus:outline-none',
      blue: 'hover:bg-blue-200 focus:outline-none dark:hover:bg-blue-900',
      green: 'hover:bg-primary-accent/30 focus:outline-none',
    },
  },
  defaultVariants: {
    color: 'green',
  },
});

const icon = cva('h-6 w-6', {
  variants: {
    color: {
      red: 'fill-destructive-foreground',
      blue: 'fill-blue-500 dark:fill-blue-600',
      green: 'fill-primary-accent',
    },
  },
  defaultVariants: {
    color: 'green',
  },
});

interface ToggleStepperProps extends VariantProps<typeof icon>, AriaToggleButtonProps {
  Icon: (props: SVGProps<SVGSVGElement>) => JSX.Element;
  quantity: number;
  noun?: string;
}

export function ToggleStepper({ Icon, quantity, noun, color, ...rest }: ToggleStepperProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const state = useToggleState(rest);
  const { buttonProps } = useToggleButton(rest, state, ref);
  const { isFocusVisible, focusProps } = useFocusRing();

  return (
    <button
      type="button"
      {...mergeProps(buttonProps, focusProps)}
      ref={ref}
      className={cn(
        'transition-transform active:scale-90',
        toggle({ color }),
        isFocusVisible && 'ring-2 ring-green-500 ring-offset-2',
      )}>
      <Icon width={24} height={24} className={cn(state.isSelected ? icon({ color }) : 'stroke-muted-foreground')} />
      <p className="text-lg font-medium text-muted-foreground">
        {quantity} {noun !== undefined ? (quantity === 1 ? noun : `${noun}s`) : ''}
      </p>
    </button>
  );
}
