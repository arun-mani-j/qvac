// Target providers passed opaquely to bare-stow's `stow()`. They ship no types;
// model them as the minimal provider shape stow expects.
declare module "bare-stow-target-react-native" {
  const target: { generate: unknown; hosts: string[] };
  export default target;
}

declare module "bare-stow-target-pear-runtime" {
  const target: { generate: unknown; hosts: string[] };
  export default target;
}
