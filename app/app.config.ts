export default defineAppConfig({
  ui: {
    colors: {
      primary: 'lime',
      neutral: 'zinc',
    },
    button: {
      slots: {
        base: 'rounded-lg cursor-pointer',
      },
      variants: {
        size: {
          md: {
            base: 'px-5 py-2.5 text-sm font-medium',
          },
        },
      },
      compoundVariants: [
        {
          variant: 'solid',
          class: 'shadow-sm transition-shadow hover:shadow-md',
        },
      ],
    },
  },
})
