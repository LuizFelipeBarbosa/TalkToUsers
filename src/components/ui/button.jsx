import { forwardRef } from 'react';

const VARIANTS = {
  filled: 'bg-accent text-white hover:bg-accent/90',
  tinted: 'bg-accent/10 text-accent hover:bg-accent/15',
  gray: 'bg-fill/[0.12] text-label hover:bg-fill/20',
  plain: 'text-label-2 hover:text-label hover:bg-fill/[0.12]',
};

const SIZES = {
  sm: 'h-7 px-2.5 gap-1 text-[12px] rounded-full',
  md: 'h-9 px-3.5 gap-1.5 text-[13.5px] rounded-full',
  icon: 'h-8 w-8 rounded-full [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
};

const Button = forwardRef(({ className = '', variant = 'gray', size = 'md', type = 'button', ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={`inline-flex shrink-0 items-center justify-center font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    {...props}
  />
));

Button.displayName = 'Button';

export { Button };
