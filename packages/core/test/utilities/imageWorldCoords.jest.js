jest.mock('../../src/metaData', () => ({
  addProvider: jest.fn(),
  get: jest.fn(),
}));

import { describe, it, expect, beforeEach } from '@jest/globals';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import * as metaData from '../../src/metaData';
import worldToImageCoords from '../../src/utilities/worldToImageCoords';
import imageToWorldCoords from '../../src/utilities/imageToWorldCoords';
import { getImageDataMetadata } from '../../src/utilities/getImageDataMetadata';

const imageId = 'test:anisotropic';

// An ultrasound frame with PixelSpacing = [0.073, 0.2]: rows are 0.073 mm
// apart (vertical), columns are 0.2 mm apart (horizontal).
const rows = 546;
const columns = 843;
const rowPixelSpacing = 0.073;
const columnPixelSpacing = 0.2;

const planes = {
  'axis-aligned': {
    rowCosines: [1, 0, 0],
    columnCosines: [0, 1, 0],
    imagePositionPatient: [0, 0, 0],
  },
  oblique: {
    rowCosines: [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0],
    columnCosines: [0, 0, -1],
    imagePositionPatient: [10, -20, 30],
  },
};

// Pixel indices (column i, row j), including the far corner of the image.
const pixels = [
  [0, 0],
  [100, 0],
  [0, 40],
  [100, 40],
  [columns - 1, rows - 1],
];

/**
 * World position of the centre of pixel (i, j) from the DICOM equation in
 * PS3.3 C.7.6.2.1.1: the row direction advances by the column spacing
 * (PixelSpacing[1]) and the column direction by the row spacing
 * (PixelSpacing[0]).
 */
function dicomPixelCentre(plane, i, j) {
  const { rowCosines, columnCosines, imagePositionPatient } = plane;
  return [0, 1, 2].map(
    (axis) =>
      imagePositionPatient[axis] +
      rowCosines[axis] * columnPixelSpacing * i +
      columnCosines[axis] * rowPixelSpacing * j
  );
}

// gl-matrix works in float32, so compare to a thousandth of a pixel or mm.
function expectClose(actual, expected) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value, 3);
  });
}

describe.each(Object.entries(planes))(
  'image <-> world coordinates with anisotropic pixel spacing (%s)',
  (_name, plane) => {
    beforeEach(() => {
      metaData.get.mockImplementation((type, id) => {
        if (id !== imageId) {
          return undefined;
        }
        if (type === 'imagePlaneModule') {
          return {
            rows,
            columns,
            rowPixelSpacing,
            columnPixelSpacing,
            ...plane,
            imageOrientationPatient: [
              ...plane.rowCosines,
              ...plane.columnCosines,
            ],
          };
        }
        if (type === 'imagePixelModule') {
          return {
            bitsAllocated: 8,
            bitsStored: 8,
            samplesPerPixel: 1,
            highBit: 7,
            photometricInterpretation: 'MONOCHROME2',
            pixelRepresentation: 0,
          };
        }
        if (type === 'generalSeriesModule') {
          return { modality: 'US' };
        }
        return undefined;
      });
    });

    it.each(pixels)(
      'imageToWorldCoords puts the centre of pixel (%i, %i) where the DICOM equation does',
      (i, j) => {
        expectClose(
          imageToWorldCoords(imageId, [i + 0.5, j + 0.5]),
          dicomPixelCentre(plane, i, j)
        );
      }
    );

    it.each(pixels)(
      'worldToImageCoords maps the centre of pixel (%i, %i) back to that pixel',
      (i, j) => {
        expectClose(
          worldToImageCoords(imageId, dicomPixelCentre(plane, i, j)),
          [i + 0.5, j + 0.5]
        );
      }
    );

    it('agrees with the vtkImageData a StackViewport renders', () => {
      const { origin, direction, spacing, dimensions } = getImageDataMetadata({
        imageId,
        rows,
        columns,
        numberOfComponents: 1,
      });
      const imageData = vtkImageData.newInstance();
      imageData.setDimensions(dimensions);
      imageData.setSpacing(spacing);
      imageData.setDirection(direction);
      imageData.setOrigin(origin);

      pixels.forEach(([i, j]) => {
        const rendered = imageData.indexToWorld([i, j, 0], [0, 0, 0]);
        expectClose(imageToWorldCoords(imageId, [i + 0.5, j + 0.5]), rendered);

        const index = imageData.worldToIndex(rendered, [0, 0, 0]);
        const imageCoords = worldToImageCoords(imageId, rendered);
        expectClose(imageCoords, [index[0] + 0.5, index[1] + 0.5]);
      });
    });
  }
);
