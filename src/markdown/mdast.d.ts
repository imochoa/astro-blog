import type { Properties } from "hast";
import "mdast";

// Sätteri preserves these fields when converting our MDAST placeholders to HAST.
// Declare the bridge independently of Remark's optional type augmentations.
declare module "mdast" {
  interface Data {
    hName?: string | undefined;
    hProperties?: Properties | undefined;
  }
}
