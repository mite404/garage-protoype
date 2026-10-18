# Seller document fixtures

Real, publicly distributed documents supplied by Ethan on 2026-10-18 for the vertical slice and
the extraction model evaluation. They are not synthetic and contain no customer or Garage data.
Use them as example seller uploads; they describe vehicle models, not a specific vehicle for sale.

- `HME-Wildland-Type1.pdf`: HME Ahrens-Fox Wildland Type 1 Model 18 brochure. Two pages with a
  text layer; page 2 is a dimension drawing.
- `MiniPumper_Sierra_Brochure2025.pdf`: BME Fire Trucks Sierra Mini Pumper brochure, 2025. Two
  page images with no text layer.
- `TM-5-4210-220-12.pdf`: US Army TM 5-4210-220-12, Truck, Firefighting, 1000 GPM Multipurpose,
  Model 2500L. 778 pages with a text layer.

The two brochures are third-party marketing material and remain their publishers' copyright.
The Army manual is marked "Approved for public release; distribution is unlimited."

The import pipeline accepts only PDFs with a text layer, so the Sierra brochure is rejected with
`NO_TEXT`. The 778-page manual exceeds a single extraction call's practical size; the evaluation
uses its equipment data pages 34 to 38.

SHA-256:

```text
01e53b1e7043be821b72c3dfb383475a3527b71716d6f4db6edd3416a472e59c  HME-Wildland-Type1.pdf
c03498e4ffcbc405443a2fcab8e53d231472db9f2e155c794bc5f295aa4f51ff  MiniPumper_Sierra_Brochure2025.pdf
587f9aef73676d73da600eadcdf4f49816fd6aa994617bf8dd383437e615d2d4  TM-5-4210-220-12.pdf
```
