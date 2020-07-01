/* eslint immutable/no-mutation: 0 */
/* eslint id-length: 0 */
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import * as csv from 'csv-string';
import { v4 as uuid } from 'uuid';
import { evaluate } from 'mathjs';
import { RequirementGroup } from '../../../shared/entity/category/requirement-group.entity';
import { Requirement } from '../../../shared/entity/category/requirement.entity';
import { SpecificationRepositoryService } from '../../../shared/modules/specification-repository';
import { generateId } from '../../../shared/utils';

import type { AlgorithmEngine } from '../../entity';
import { AvailableVariant } from '../../entity/available-variant';
import { RequirementResponse } from '../../entity/requirement-response';
import { Metric } from '../../entity/variant';

import type { CalculationPayload, CalculationResponse } from '../../entity/calculation';
import type { SpecificationPayload, SpecificationResponse } from '../../entity/specification';

import { DocumentsService } from '../../services/documents';
import { Criterion, Option } from '../../../shared/entity/category';
import { DocxGeneratorService } from '../../services/docx-generator';

enum Variants {
  Incandescent = '31519100-8',
  Halogen = '31512000-8',
  Fluorescent = '31532900-3',
  LED = '31712341-2',
}

enum LightFlowType {
  Directional = 'directional',
  NonDirectional = 'non-directional',
}

type TechCharacteristics = {
  [key in Variants]: {
    lumPerWatt: number;
    timeRate: number;
    availablePowers: number[];
  };
};

type Calculation = {
  [key in Variants]: {
    quantity: number;
    power: number;
    lum: number;
    pRef: number;
    eei: number;
    eeClass: string;
    modeOfUseLifetime?: number;
    workingHoursInYear?: number;
    energyEconomy?: number;
    financeEconomy?: number;
  };
};

export class LightingEquipmentAndElectricLamps implements AlgorithmEngine {
  public readonly categoryId = '31500000-1';

  public constructor(
    private documents: DocumentsService,
    private specifications: SpecificationRepositoryService,
    private docxGenerator: DocxGeneratorService
  ) {}

  private static calculateEnergyEfficiencyClass(eei: number): string {
    if (eei <= 0.13) {
      return 'A++';
    }

    if (eei > 0.13 && eei <= 0.18) {
      return 'A+';
    }

    if (eei > 0.18 && eei <= 0.4) {
      return 'A';
    }

    if (eei > 0.4 && eei <= 0.95) {
      return 'B';
    }

    if (eei > 0.95 && eei <= 1.2) {
      return 'C';
    }

    if (eei > 1.2 && eei <= 1.75) {
      return 'D';
    }

    return 'E';
  }

  private static getValueFromResponses(responses: RequirementResponse[], requirementId: string): unknown {
    return responses.find(({ requirement: { id } }) => {
      return id === requirementId;
    })?.value as unknown;
  }

  private static getDirectoryPower(providedPower: number, availablePowers: number[]): number {
    return (
      availablePowers.find(
        (availablePower: number) => {
          return availablePower >= providedPower;
        }
        // @TODO need clarification
      ) || Math.max(...availablePowers)
    );
  }

  private static generateAvailableVariants(
    availableBulbTypes: Calculation,
    selectedBulbType: Variants,
    techCharacteristics: TechCharacteristics
  ): AvailableVariant[] {
    const unsortedVariants: AvailableVariant[] = (Object.keys(availableBulbTypes) as Variants[]).map((bulbType) => {
      const currentBulb = availableBulbTypes[bulbType];

      const metrics: Metric[] = [];

      metrics.push(
        {
          id: '0100',
          title: 'Технічні показники',
          observations: [
            {
              id: '0101',
              notes: 'Потужність',
              measure: currentBulb.power,
              unit: {
                id: '345',
                name: 'Вт',
              },
            },
            {
              id: '0102',
              notes: 'Термін експлуатації',
              measure: techCharacteristics[bulbType].timeRate,
              unit: {
                id: '155',
                name: 'год',
              },
            },
          ],
        },
        {
          id: '0200',
          title: 'Показники енергоефективності',
          observations: [
            {
              id: '0201',
              notes: 'Індекс енергоефективності',
              measure: currentBulb.eei,
            },
            {
              id: 'energyEfficiencyClass',
              notes: 'Клас енергоефективності',
              measure: currentBulb.eeClass,
            },
          ],
        }
      );

      if (bulbType !== selectedBulbType) {
        metrics.push({
          id: '0300',
          title: 'Економічні показники',
          observations: [
            {
              id: 'serviceLife',
              notes: 'Термін служби',
              measure: (
                techCharacteristics[bulbType].timeRate / techCharacteristics[selectedBulbType].timeRate
              ).toFixed(1),
            },
          ],
        });

        if (currentBulb.energyEconomy) {
          const observations = [];

          observations.push({
            id: 'energyEconomy',
            notes: 'Менше енергії',
            measure: currentBulb.energyEconomy.toFixed(0),
            unit: {
              id: '332',
              name: 'кВт*год/рік',
            },
          });

          if (currentBulb.financeEconomy) {
            observations.push({
              id: 'financeEconomy',
              notes: 'Фінансової економії',
              value: {
                amount: +currentBulb.financeEconomy.toFixed(0),
                currency: 'грн/рік' as 'UAH',
              },
            });
          }

          // eslint-disable-next-line no-unused-expressions
          metrics.find((metric) => metric.id === '0300')?.observations.push(...observations);
        }
      }

      return {
        id: uuid(),
        relatedItem: bulbType,
        quantity: availableBulbTypes[bulbType].quantity,
        metrics,
        avgValue: {
          amount: 0,
          currency: 'UAH',
        },
        relatedProducts: ['https://prozorro.gov.ua/ProzorroMarket'],
        criteria: [
          {
            id: '0100000000',
            title: 'Додаткова інформація',
            description: 'Оберіть варіант освітлення',
            requirementGroups: [
              {
                id: '0101000000',
                requirements: [
                  {
                    id: '0101010000',
                    title: 'Спрямоване освітлення',
                    dataType: 'boolean',
                    expectedValue: true,
                  },
                ],
              },
              {
                id: '0102000000',
                requirements: [
                  {
                    id: '0102010000',
                    title: 'Розсіяне освітлення',
                    dataType: 'boolean',
                    expectedValue: true,
                  },
                ],
              },
            ],
          },
        ],
      };
    });

    return [
      unsortedVariants.find((variant) => variant.relatedItem === selectedBulbType) as AvailableVariant,
      ...unsortedVariants
        .filter((variant) => variant.relatedItem !== selectedBulbType)
        .sort((variantA, variantB) => {
          return (
            (variantA.metrics[1].observations[0].measure as number) -
            (variantB.metrics[1].observations[0].measure as number)
          );
        }),
    ];
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  public async getCalculation({
    category: { items, criteria, conversions },
    version,
    requestedNeed: { requirementResponses },
  }: CalculationPayload): Promise<CalculationResponse> {
    const directoryTable = await this.getDirectoryTable(this.categoryId);

    const techChars = directoryTable.reduce((_techChars, row) => {
      if (!/^.+\/.+$/.test(row[0])) return _techChars;

      const bulbType = row[0].replace(/\/.+$/, '').replace('/', '') as Variants;
      const techCharName = row[0].replace(/^.+\//, '').replace('/', '');

      return {
        ..._techChars,
        [bulbType]: {
          ..._techChars[bulbType],
          [techCharName]: techCharName === 'availablePowers' ? row[1].split(';').map(Number) : Number(row[1]),
        },
      };
    }, {} as TechCharacteristics);

    const weeksInYear = +(directoryTable.find((row) => row[0] === 'weeksInYear')?.[1] || 0);

    if (!weeksInYear) {
      throw new UnprocessableEntityException('No "weeksInYear" data in reference data');
    }

    const formulasTable = await this.getFormulasTable(this.categoryId);

    const calculatedValuesMap = {
      Φ: 'lum',
      Pref: 'pRef',
      EEI: 'eei',
      lightRateLux: 'lightRateLux',
      P: 'power',
      workingHoursInWeek: 'workingHoursInWeek',
      workingHoursInYear: 'workingHoursInYear',
      energyEconomy: 'energyEconomy',
      financeEconomy: 'financeEconomy',
    } as const;

    type CalculatedKeys = keyof typeof calculatedValuesMap;
    type CalculatedValues = typeof calculatedValuesMap[CalculatedKeys];
    type Formulas = Record<CalculatedValues, string>;

    const formulas: Formulas = Object.keys(calculatedValuesMap).reduce((_formulas, value) => {
      const formula = formulasTable.find(([_value]) => _value === value)?.[1];

      if (!formula) {
        throw new UnprocessableEntityException(`There is no formula for calculating "${value}"`);
      }

      return {
        ..._formulas,
        [calculatedValuesMap[value as CalculatedKeys]]: formula,
      };
    }, {} as Formulas);

    const calculationDraft = Object.values(Variants).reduce((_calculation, bulbCode: Variants) => {
      return {
        ..._calculation,
        [bulbCode]: {},
      };
    }, {} as Calculation);

    const selectedBulbType = requirementResponses.find(({ requirement }) => requirement.id.startsWith('02'))?.value as
      | Variants
      | undefined;

    if (selectedBulbType === undefined || !Object.values(Variants).includes(selectedBulbType)) {
      throw new UnprocessableEntityException(`Incorrect lamp type was provided.`);
    }

    const bulbTypeNeedIsPresent = items.some((item) => item.id === selectedBulbType);

    if (!bulbTypeNeedIsPresent) {
      throw new BadRequestException(`Provided bulb type '${selectedBulbType}' is missing in category items.`);
    }

    // 1) Type of need
    const typeOfNeedResponses = requirementResponses.filter(({ requirement }) => requirement.id.startsWith('01'));

    const typeOfNeedResponsesIsConsistent = typeOfNeedResponses.every(({ requirement }) => {
      return typeOfNeedResponses[0].requirement.id.slice(2, 4) === requirement.id.slice(2, 4);
    });

    if (!typeOfNeedResponsesIsConsistent) {
      throw new BadRequestException(
        `Requirement responses for the type of need are given from different requirement groups.`
      );
    }

    // 1.1) Calculation for specific bulb
    if (typeOfNeedResponses[0].requirement.id.slice(2, 4) === '01') {
      const requirementIdForBulbPower = '0101010000';
      const requirementIdForBulbQuantity = '0101020000';

      const providedPower = LightingEquipmentAndElectricLamps.getValueFromResponses(
        typeOfNeedResponses,
        requirementIdForBulbPower
      );

      if (typeof providedPower !== 'number' || providedPower <= 0) {
        throw new BadRequestException(`Incorrect value of power provided for calculation.`);
      }

      const directoryPower = LightingEquipmentAndElectricLamps.getDirectoryPower(
        providedPower,
        techChars[selectedBulbType].availablePowers
      );

      const lum = evaluate(formulas.lum, {
        P: directoryPower,
        η: techChars[selectedBulbType].lumPerWatt,
      });

      const providedQuantity = LightingEquipmentAndElectricLamps.getValueFromResponses(
        typeOfNeedResponses,
        requirementIdForBulbQuantity
      );

      if (typeof providedQuantity !== 'number' || providedPower <= 0 || !Number.isInteger(providedQuantity)) {
        throw new BadRequestException(`Incorrect quantity provided for calculation.`);
      }

      // TechChars of bulb () =>
      (Object.keys(calculationDraft) as Variants[]).forEach((bulbType) => {
        const currentBulb = calculationDraft[bulbType];

        currentBulb.quantity = providedQuantity;

        if (bulbType !== selectedBulbType) {
          currentBulb.power = LightingEquipmentAndElectricLamps.getDirectoryPower(
            lum / techChars[bulbType].lumPerWatt,
            techChars[bulbType].availablePowers
          );
        } else {
          currentBulb.power = directoryPower;
        }

        // @ToDo: Need clarification @mr.rotberry
        currentBulb.lum = evaluate(formulas.lum, {
          P: currentBulb.power,
          η: techChars[bulbType].lumPerWatt,
        });
        currentBulb.pRef = evaluate(formulas.pRef, {
          Φ: currentBulb.lum,
        });
        currentBulb.eei = Number(
          evaluate(formulas.eei, {
            P: currentBulb.power,
            Pref: currentBulb.pRef,
          }).toFixed(2)
        );
      });
    }

    // 1.2) Calculation for a light project
    if (typeOfNeedResponses[0].requirement.id.slice(2, 4) === '02') {
      enum RequirementId {
        TypeOfRoom = '0102010000',
        RoomArea = '0102020000',
        Quantity = '0102030000',
      }

      const typeOfRoom = LightingEquipmentAndElectricLamps.getValueFromResponses(
        typeOfNeedResponses,
        RequirementId.TypeOfRoom
      );

      if (!typeOfRoom || typeof typeOfRoom !== 'string') {
        throw new BadRequestException(`Incorrect value of room type provided for calculation.`);
      }

      const lightRateInLum = conversions
        ?.find(({ relatedItem }) => relatedItem === RequirementId.TypeOfRoom)
        ?.coefficients?.find(({ value }) => ((value as unknown) as string) === typeOfRoom)?.coefficient;

      if (!lightRateInLum) {
        throw new BadRequestException(`Can't find lumen value for ${typeOfRoom} type of room.`);
      }

      const roomArea = LightingEquipmentAndElectricLamps.getValueFromResponses(
        typeOfNeedResponses,
        RequirementId.RoomArea
      );

      if (!roomArea || typeof roomArea !== 'number' || roomArea <= 0) {
        throw new BadRequestException(`Incorrect room area value provided for calculation of the light project.`);
      }

      // @ToDo: Need clarification @mr.rotberry
      const bulbsQuantity = LightingEquipmentAndElectricLamps.getValueFromResponses(
        typeOfNeedResponses,
        RequirementId.Quantity
      );

      if (
        !bulbsQuantity ||
        typeof bulbsQuantity !== 'number' ||
        bulbsQuantity <= 0 ||
        !Number.isInteger(bulbsQuantity)
      ) {
        throw new BadRequestException(`Incorrect quantity provided for calculation of the light project.`);
      }

      const lightRateLux = evaluate(formulas.lightRateLux, {
        lightRateInLum,
        roomArea,
      });

      (Object.keys(calculationDraft) as Variants[]).forEach((bulbType) => {
        const currentBulb = calculationDraft[bulbType];

        const calculationPower = evaluate(formulas.power, {
          lightRateLux,
          quantity: bulbsQuantity,
          η: techChars[bulbType].lumPerWatt,
        });

        currentBulb.quantity = bulbsQuantity;
        currentBulb.power = LightingEquipmentAndElectricLamps.getDirectoryPower(
          calculationPower,
          techChars[bulbType].availablePowers
        );
        currentBulb.lum = evaluate(formulas.lum, {
          P: currentBulb.power,
          η: techChars[bulbType].lumPerWatt,
        });
        currentBulb.pRef = evaluate(formulas.pRef, {
          Φ: currentBulb.lum,
        });
        currentBulb.eei = Number(
          evaluate(formulas.eei, {
            P: currentBulb.power,
            Pref: currentBulb.pRef,
          }).toFixed(2)
        );
      });
    }

    // 1.3) Calculation for a custom light project
    if (typeOfNeedResponses[0].requirement.id.slice(2, 4) === '03') {
      enum RequirementId {
        RoomArea = '0103010000',
        LightLevel = '0103020000',
        Quantity = '0103030000',
      }

      const roomArea = LightingEquipmentAndElectricLamps.getValueFromResponses(
        typeOfNeedResponses,
        RequirementId.RoomArea
      );

      if (!roomArea || typeof roomArea !== 'number' || roomArea <= 0) {
        throw new BadRequestException(
          `Incorrect room area value provided for calculation of the custom light project.`
        );
      }

      const lightLevel = LightingEquipmentAndElectricLamps.getValueFromResponses(
        typeOfNeedResponses,
        RequirementId.LightLevel
      );

      if (typeof lightLevel !== 'string' || !['low', 'regular', 'high', 'intensive'].includes(lightLevel)) {
        throw new BadRequestException(
          `Incorrect light level value provided for calculation of the custom light project.`
        );
      }

      const lightRateInLum = conversions
        ?.find(({ relatedItem }) => relatedItem === RequirementId.LightLevel)
        ?.coefficients?.find(({ value }) => ((value as unknown) as string) === lightLevel)?.coefficient;

      if (!lightRateInLum) {
        throw new BadRequestException(`Can't find lumen value for specified light level ${lightLevel}.`);
      }

      const bulbsQuantity = LightingEquipmentAndElectricLamps.getValueFromResponses(
        typeOfNeedResponses,
        RequirementId.Quantity
      );

      // @ToDo: Need clarification @mr.rotberry
      if (
        !bulbsQuantity ||
        typeof bulbsQuantity !== 'number' ||
        bulbsQuantity <= 0 ||
        !Number.isInteger(bulbsQuantity)
      ) {
        throw new BadRequestException(`Incorrect quantity provided for calculation of the custom light project.`);
      }

      const lightRateLux = evaluate(formulas.lightRateLux, {
        lightRateInLum,
        roomArea,
      });

      // @ToDo: Need clarification @mr.rotberry
      // eslint-disable-next-line sonarjs/no-identical-functions
      (Object.keys(calculationDraft) as Variants[]).forEach((bulbType) => {
        const currentBulb = calculationDraft[bulbType];

        const calculationPower = evaluate(formulas.power, {
          lightRateLux,
          quantity: bulbsQuantity,
          η: techChars[bulbType].lumPerWatt,
        });

        currentBulb.quantity = bulbsQuantity;
        currentBulb.power = LightingEquipmentAndElectricLamps.getDirectoryPower(
          calculationPower,
          techChars[bulbType].availablePowers
        );
        currentBulb.lum = evaluate(formulas.lum, {
          P: currentBulb.power,
          η: techChars[bulbType].lumPerWatt,
        });
        currentBulb.pRef = evaluate(formulas.pRef, {
          Φ: currentBulb.lum,
        });
        currentBulb.eei = Number(
          evaluate(formulas.eei, {
            P: currentBulb.power,
            Pref: currentBulb.pRef,
          }).toFixed(2)
        );
      });
    }

    // 2) Selecting more effective bulbs
    const eeiOfBulbTypeNeed = calculationDraft[selectedBulbType].eei;

    const availableBulbTypes = (Object.keys(calculationDraft) as Variants[]).reduce(
      (_availableBulbTypes, bulbType: Variants) => {
        if (calculationDraft[bulbType].eei <= eeiOfBulbTypeNeed) {
          const requirementGroups = criteria.flatMap((criterion) => criterion.requirementGroups);
          const bulbTypeRequirementGroup = requirementGroups.find((requirementGroup) => {
            return (
              requirementGroup.id ===
              requirementResponses
                .find(({ requirement }) => requirement.id.startsWith('02'))
                ?.requirement.id?.replace(/\d{6}$/, '000000')
            );
          });

          const bulbTypes = bulbTypeRequirementGroup?.requirements[0]?.optionDetails?.optionGroups[0].options.flatMap(
            (option: Option) => option.value
          );

          if (bulbTypes?.find((categoryBulbType) => (categoryBulbType as string) === bulbType) === undefined) {
            return _availableBulbTypes;
          }

          return {
            ..._availableBulbTypes,
            [bulbType]: calculationDraft[bulbType],
          };
        }
        return _availableBulbTypes;
      },
      {} as Calculation
    );

    if (Object.keys(availableBulbTypes).length === 0) {
      throw new BadRequestException('Incorrect type of need provided.');
    }

    // 3) Bulb lifetime
    const modeOfUseResponses = requirementResponses.filter(({ requirement }) => requirement.id.startsWith('03'));

    if (modeOfUseResponses.length === 0) {
      throw new BadRequestException(`Mode of use responses must be provided.`);
    }

    const modeOfUseResponsesIsConsistent = modeOfUseResponses.every(({ requirement }) => {
      return modeOfUseResponses[0].requirement.id.slice(2, 4) === requirement.id.slice(2, 4);
    });

    if (!modeOfUseResponsesIsConsistent) {
      throw new BadRequestException(
        `Requirement responses for mode of use are given from different requirement groups.`
      );
    }

    if (modeOfUseResponses[0].requirement.id.slice(2, 4) === '01') {
      const hoursInDay = modeOfUseResponses[0]?.value as unknown;
      const daysInWeek = modeOfUseResponses[1]?.value as unknown;

      if (typeof hoursInDay !== 'number' || hoursInDay <= 0 || hoursInDay > 24) {
        throw new BadRequestException('Incorrect working hours per day provided.');
      }

      if (typeof daysInWeek !== 'number' || daysInWeek <= 0 || daysInWeek > 7) {
        throw new BadRequestException('Incorrect working days per week provided.');
      }

      (Object.keys(availableBulbTypes) as Variants[]).forEach((bulbType) => {
        const workingHoursInWeek = evaluate(formulas.workingHoursInWeek, {
          hoursInDay,
          daysInWeek,
        });
        const workingHoursInYear = evaluate(formulas.workingHoursInYear, {
          workingHoursInWeek,
          weeksInYear,
        });

        availableBulbTypes[bulbType].workingHoursInYear = workingHoursInYear;
        availableBulbTypes[bulbType].modeOfUseLifetime = +(techChars[bulbType].timeRate / workingHoursInYear).toFixed(
          2
        );
      });
    }

    // 4) Economy
    const tariffsRequirements = requirementResponses.filter(({ requirement }) => requirement.id.startsWith('04'));

    if (tariffsRequirements.length !== 1) {
      throw new BadRequestException(`Incorrect tariffs information provided.`);
    }

    (Object.keys(availableBulbTypes) as Variants[]).forEach((bulbType) => {
      const { quantity, power, workingHoursInYear } = availableBulbTypes[bulbType];

      if (workingHoursInYear) {
        availableBulbTypes[bulbType].energyEconomy = evaluate(formulas.energyEconomy, {
          Pselected: availableBulbTypes[selectedBulbType].power,
          quantity,
          Pother: power,
          workingHoursInYear,
        });

        const tariff = tariffsRequirements[0].value;

        if (typeof tariff === 'number' && tariff > 0) {
          availableBulbTypes[bulbType].financeEconomy = +evaluate(formulas.financeEconomy, {
            Pselected: availableBulbTypes[selectedBulbType].power,
            quantity,
            tariff,
            Pother: power,
            workingHoursInYear,
          }).toFixed(2);
        }
      }
    });

    // 5) Efficiency
    (Object.keys(availableBulbTypes) as Variants[]).forEach((bulbType) => {
      availableBulbTypes[bulbType].eeClass = LightingEquipmentAndElectricLamps.calculateEnergyEfficiencyClass(
        availableBulbTypes[bulbType].eei
      );
    });

    const availableVariants = LightingEquipmentAndElectricLamps.generateAvailableVariants(
      availableBulbTypes,
      selectedBulbType,
      techChars
    );

    return {
      category: this.categoryId,
      version,
      requestedVariant: selectedBulbType,
      recommendedVariant: availableVariants[availableVariants.length > 1 ? 1 : 0].id,
      availableVariants,
    };
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  public async getSpecification({
    category,
    version,
    selectedVariant: { selectedVariant },
    egp,
    mode,
  }: SpecificationPayload): SpecificationResponse {
    const relatedItem = selectedVariant.relatedItem as Variants;

    const directoryTable = await this.getDirectoryTable(this.categoryId);

    const techChars = directoryTable.reduce((_techChars, row) => {
      if (!/^.+\/.+$/.test(row[0])) return _techChars;

      const bulbType = row[0].replace(/\/.+$/, '').replace('/', '') as Variants;
      const techCharName = row[0].replace(/^.+\//, '').replace('/', '');

      return {
        ..._techChars,
        [bulbType]: {
          ..._techChars[bulbType],
          [techCharName]: row[1],
        },
      };
    }, {} as TechCharacteristics);

    const directionalLightFlowResponses = selectedVariant.requirementResponses.filter(({ requirement }) => {
      return requirement.id.startsWith('01');
    });

    if (
      directionalLightFlowResponses.length !== 1 ||
      typeof directionalLightFlowResponses[0].value !== 'boolean' ||
      !directionalLightFlowResponses[0].value
    ) {
      throw new BadRequestException(`Incorrect information for directional lighting provided.`);
    }

    const efficacyRequirementsBaseId = '0101';
    const functionalityRequirementsBaseId = '0201';

    const lightFlowType =
      new RegExp(efficacyRequirementsBaseId).test(directionalLightFlowResponses[0].requirement.id) &&
      directionalLightFlowResponses[0]?.value !== undefined
        ? LightFlowType.Directional
        : LightFlowType.NonDirectional;

    const power = selectedVariant.metrics
      .find((metric) => metric.id === '0100')
      ?.observations.find((observation) => observation.id === efficacyRequirementsBaseId)?.measure;

    if (typeof power !== 'number' || power <= 0) {
      throw new BadRequestException(`Bulb power was not transferred or its value is 0 or less.`);
    }

    const lightFlowValue = power * techChars[relatedItem].lumPerWatt;

    const PmaxCor = lightFlowValue >= 60 && lightFlowValue <= 450 ? 1.84 : 1;

    const efficacyRequirementGroup: RequirementGroup = {
      id: `${efficacyRequirementsBaseId}00`,
      requirements: [],
    };

    efficacyRequirementGroup.requirements.push(
      ...[
        {
          title: 'Максимальна номінальна потужність (Pmax)',
          expectedValue: +(0.6 * (0.88 * Math.sqrt(lightFlowValue) + 0.049 * lightFlowValue) * PmaxCor).toFixed(2),
          unit: {
            id: '',
            name: 'W',
          },
        },
        {
          title: 'Коефіцієнт коригування Pmax',
          expectedValue: +PmaxCor,
        },
      ].map(generateId(efficacyRequirementsBaseId))
    );

    const efficacyCriterion: Criterion = {
      id: '010000',
      title: 'Вимоги до ефективності',
      requirementGroups: [efficacyRequirementGroup],
    };

    const functionalityRequirementGroup: RequirementGroup = {
      id: `${functionalityRequirementsBaseId}00`,
      requirements: [],
    };

    enum Functionality {
      RatedLifetime = 'Rated lifetime',
      LumenMaintenance = 'Lumen maintenance',
      SwitchingCycle = 'Switching cycle',
      StartingTime = 'Starting time',
      WarmUp = 'Warm up',
      PrematureFailure = 'Premature failure rate',
      PowerFactor = 'Power factor',
      ColourRendering = 'Colour rendering (Ra)',
      SurvivalFactor = 'Survival factor',
    }

    switch (relatedItem) {
      case Variants.Incandescent: {
        switch (lightFlowType) {
          case LightFlowType.NonDirectional: {
            functionalityRequirementGroup.requirements.push(
              ...([
                {
                  title: Functionality.RatedLifetime,
                  dataType: 'integer',
                  minValue: 2000,
                  unit: {
                    id: '',
                    name: 'h',
                  },
                },
                {
                  title: `${Functionality.LumenMaintenance} at 75% of rated average lifetime`,
                  dataType: 'integer',
                  minValue: 85,
                  unit: {
                    id: '',
                    name: '%',
                  },
                },
                {
                  title: Functionality.SwitchingCycle,
                  dataType: 'integer',
                  minValue: 4 * techChars[Variants.Incandescent].timeRate,
                },
                {
                  title: Functionality.StartingTime,
                  dataType: 'number',
                  maxValue: 0.2,
                  unit: {
                    id: '',
                    name: 's',
                  },
                },
                {
                  title: `${Functionality.WarmUp} to 60% of lumenus flux`,
                  dataType: 'number',
                  maxValue: 1,
                  unit: {
                    id: '',
                    name: 's',
                  },
                },
                {
                  title: `${Functionality.PrematureFailure} at 200 h`,
                  dataType: 'number',
                  maxValue: 5,
                  unit: {
                    id: '',
                    name: '%',
                  },
                },
                {
                  title: Functionality.PowerFactor,
                  dataType: 'number',
                  minValue: 0.95,
                },
              ].map(generateId(functionalityRequirementsBaseId)) as Requirement[])
            );

            break;
          }

          case LightFlowType.Directional:
          default: {
            functionalityRequirementGroup.requirements.push(
              ...([
                {
                  title: Functionality.RatedLifetime,
                  dataType: 'integer',
                  minValue: 2000,
                  unit: {
                    id: '',
                    name: 'h',
                  },
                },
                {
                  title: `${Functionality.LumenMaintenance} at 75% of rated average lifetime`,
                  dataType: 'integer',
                  minValue: 80,
                  unit: {
                    id: '',
                    name: '%',
                  },
                },
                {
                  title: Functionality.SwitchingCycle,
                  dataType: 'integer',
                  minValue: 4 * techChars[Variants.Incandescent].timeRate,
                },
                {
                  title: Functionality.StartingTime,
                  dataType: 'number',
                  maxValue: 0.2,
                  unit: {
                    id: '',
                    name: 's',
                  },
                },
                {
                  title: `${Functionality.WarmUp} to 60% of lumenus flux`,
                  dataType: 'number',
                  maxValue: 1,
                  unit: {
                    id: '',
                    name: 's',
                  },
                },
                {
                  title: `${Functionality.PrematureFailure} at 200 h`,
                  dataType: 'number',
                  maxValue: 5,
                  unit: {
                    id: '',
                    name: '%',
                  },
                },
                {
                  title: Functionality.PowerFactor,
                  dataType: 'number',
                  minValue: power <= 25 ? 0.5 : 0.95,
                },
              ].map(generateId(functionalityRequirementsBaseId)) as Requirement[])
            );
          }
        }

        break;
      }

      case Variants.Halogen: {
        switch (lightFlowType) {
          case LightFlowType.NonDirectional: {
            functionalityRequirementGroup.requirements.push(
              ...([
                {
                  title: Functionality.RatedLifetime,
                  dataType: 'integer',
                  minValue: 2000,
                  unit: {
                    id: '',
                    name: 'h',
                  },
                },
                {
                  title: `${Functionality.LumenMaintenance} at 75% of rated average lifetime`,
                  dataType: 'integer',
                  minValue: 85,
                  unit: {
                    id: '',
                    name: '%',
                  },
                },
                {
                  title: Functionality.SwitchingCycle,
                  dataType: 'integer',
                  minValue: 4 * techChars[Variants.Halogen].timeRate,
                },
                {
                  title: Functionality.StartingTime,
                  dataType: 'number',
                  maxValue: 0.2,
                  unit: {
                    id: '',
                    name: 's',
                  },
                },
                {
                  title: `${Functionality.WarmUp} to 60% of lumenus flux`,
                  dataType: 'number',
                  maxValue: 1,
                  unit: {
                    id: '',
                    name: 's',
                  },
                },
                {
                  title: `${Functionality.PrematureFailure} at 200 h`,
                  dataType: 'number',
                  maxValue: 5,
                  unit: {
                    id: '',
                    name: '%',
                  },
                },
                {
                  title: Functionality.PowerFactor,
                  dataType: 'number',
                  minValue: 0.95,
                },
              ].map(generateId(functionalityRequirementsBaseId)) as Requirement[])
            );

            break;
          }

          case LightFlowType.Directional:
          default: {
            functionalityRequirementGroup.requirements.push(
              ...([
                {
                  title: Functionality.RatedLifetime,
                  dataType: 'integer',
                  minValue: 2000,
                  unit: {
                    id: '',
                    name: 'h',
                  },
                },
                {
                  title: `${Functionality.LumenMaintenance} at 75% of rated average lifetime`,
                  dataType: 'integer',
                  minValue: 80,
                  unit: {
                    id: '',
                    name: '%',
                  },
                },
                {
                  title: Functionality.SwitchingCycle,
                  dataType: 'integer',
                  minValue: 4 * techChars[Variants.Halogen].timeRate,
                },
                {
                  title: Functionality.StartingTime,
                  dataType: 'number',
                  maxValue: 0.2,
                  unit: {
                    id: '',
                    name: 's',
                  },
                },
                {
                  title: `${Functionality.WarmUp} to 60% of lumenus flux`,
                  dataType: 'number',
                  maxValue: 1,
                  unit: {
                    id: '',
                    name: 's',
                  },
                },
                {
                  title: `${Functionality.PrematureFailure} at 200 h`,
                  dataType: 'number',
                  maxValue: 5,
                  unit: {
                    id: '',
                    name: '%',
                  },
                },
                {
                  title: Functionality.PowerFactor,
                  dataType: 'number',
                  minValue: power <= 25 ? 0.5 : 0.95,
                },
              ].map(generateId(functionalityRequirementsBaseId)) as Requirement[])
            );
          }
        }

        break;
      }

      case Variants.Fluorescent: {
        switch (lightFlowType) {
          case LightFlowType.NonDirectional: {
            functionalityRequirementGroup.requirements.push(
              ...([
                {
                  title: `${Functionality.SurvivalFactor} at 6000 h`,
                  dataType: 'number',
                  minValue: 0.7,
                },
                {
                  title: `${Functionality.LumenMaintenance} at 2000 h`,
                  dataType: 'integer',
                  minValue: 88,
                  unit: {
                    id: '',
                    name: '%',
                  },
                },
                {
                  title: `${Functionality.LumenMaintenance} at 6000 h`,
                  dataType: 'integer',
                  minValue: 70,
                  unit: {
                    id: '',
                    name: '%',
                  },
                },
                {
                  title: Functionality.SwitchingCycle,
                  dataType: 'integer',
                  minValue: 0,
                  unit: {
                    id: '',
                    name: 'h',
                  },
                },
                {
                  title: Functionality.StartingTime,
                  dataType: 'number',
                  maxValue: power >= 10 ? 1 : 1.5,
                  unit: {
                    id: '',
                    name: 's',
                  },
                },
                {
                  title: `${Functionality.WarmUp} to 60% of lumenus flux`,
                  dataType: 'integer',
                  maxValue: 40,
                  unit: {
                    id: '',
                    name: 's',
                  },
                },
                {
                  title: `${Functionality.PrematureFailure} at 400 h`,
                  dataType: 'integer',
                  maxValue: 2,
                  unit: {
                    id: '',
                    name: '%',
                  },
                },
                {
                  title: 'UVA + UVB radiation',
                  dataType: 'integer',
                  maxValue: 2,
                  unit: {
                    id: '',
                    name: 'kW/klm',
                  },
                },
                {
                  title: 'UVC radiation',
                  dataType: 'number',
                  maxValue: 0.01,
                  unit: {
                    id: '',
                    name: 'kW/klm',
                  },
                },
                {
                  title: Functionality.PowerFactor,
                  dataType: 'number',
                  minValue: power <= 25 ? 0.55 : 0.9,
                  unit: {
                    id: '',
                    name: 'kW/klm',
                  },
                },
                {
                  title: Functionality.ColourRendering,
                  dataType: 'integer',
                  maxValue: 80,
                  unit: {
                    id: '',
                    name: 'Ra',
                  },
                },
              ].map(generateId(functionalityRequirementsBaseId)) as Requirement[])
            );

            break;
          }

          case LightFlowType.Directional:
          default: {
            functionalityRequirementGroup.requirements.push(
              ...([
                {
                  title: `${Functionality.SurvivalFactor} at 6000 h`,
                  dataType: 'number',
                  minValue: 0.7,
                },
                {
                  title: `${Functionality.LumenMaintenance} at 2000 h`,
                  dataType: 'integer',
                  minValue: 83,
                  unit: {
                    id: '',
                    name: '%',
                  },
                },
                {
                  title: `${Functionality.LumenMaintenance} at 6000 h`,
                  dataType: 'integer',
                  minValue: 70,
                  unit: {
                    id: '',
                    name: '%',
                  },
                },
                {
                  title: Functionality.SwitchingCycle,
                  dataType: 'integer',
                  minValue: 0,
                  unit: {
                    id: '',
                    name: 'h',
                  },
                },
                {
                  title: Functionality.StartingTime,
                  dataType: 'number',
                  maxValue: power >= 10 ? 1 : 1.5,
                  unit: {
                    id: '',
                    name: 's',
                  },
                },
                {
                  title: `${Functionality.WarmUp} to 60% of lumenus flux`,
                  dataType: 'integer',
                  maxValue: 40,
                  unit: {
                    id: '',
                    name: 's',
                  },
                },
                {
                  title: `${Functionality.PrematureFailure} at 1000 h`,
                  dataType: 'integer',
                  maxValue: 5,
                  unit: {
                    id: '',
                    name: '%',
                  },
                },
                {
                  title: Functionality.PowerFactor,
                  dataType: 'number',
                  minValue: power <= 25 ? 0.55 : 0.9,
                  unit: {
                    id: '',
                    name: 'kW/klm',
                  },
                },
                {
                  title: Functionality.ColourRendering,
                  dataType: 'integer',
                  maxValue: 80,
                  unit: {
                    id: '',
                    name: 'Ra',
                  },
                },
              ].map(generateId(functionalityRequirementsBaseId)) as Requirement[])
            );
          }
        }

        break;
      }

      case Variants.LED:
      default: {
        functionalityRequirementGroup.requirements.push(
          ...([
            {
              title: `${Functionality.SurvivalFactor} at 6000 h`,
              dataType: 'number',
              minValue: 0.9,
            },
            {
              title: `${Functionality.LumenMaintenance} at 6000 h`,
              dataType: 'integer',
              minValue: 80,
              unit: {
                id: '',
                name: '%',
              },
            },
            {
              title: Functionality.SwitchingCycle,
              dataType: 'integer',
              minValue: 0,
              unit: {
                id: '',
                name: 'h',
              },
            },
            {
              title: Functionality.StartingTime,
              dataType: 'number',
              maxValue: 0.5,
              unit: {
                id: '',
                name: 's',
              },
            },
            {
              title: `${Functionality.WarmUp} to 95% of lumenus flux`,
              dataType: 'number',
              maxValue: 2,
              unit: {
                id: '',
                name: 's',
              },
            },
            {
              title: `${Functionality.PrematureFailure} at 1000 h`,
              dataType: 'integer',
              maxValue: 5,
              unit: {
                id: '',
                name: '%',
              },
            },
            {
              title: Functionality.PowerFactor,
              dataType: 'number',
              // eslint-disable-next-line consistent-return
              minValue: ((): number | void => {
                if (power >= 2 && power <= 5) {
                  return 0.4;
                }

                if (power > 5 && power <= 25) {
                  return 0.5;
                }

                if (power > 25) {
                  return 0.9;
                }
              })(),
              unit: {
                id: '',
                name: '%',
              },
            },
            {
              title: Functionality.ColourRendering,
              dataType: 'integer',
              minValue: 80,
              unit: {
                id: '',
                name: 'Ra',
              },
            },
          ].map(generateId(functionalityRequirementsBaseId)) as Requirement[])
        );
      }
    }

    const functionalityCriterion: Criterion = {
      id: '',
      title: 'Вимоги до функціональності',
      requirementGroups: [functionalityRequirementGroup],
    };

    const criteria = [efficacyCriterion, functionalityCriterion];

    if (egp === 'prozorro') {
      switch (mode) {
        case 'json': {
          return this.specifications.createOne([this.categoryId, version], criteria);
        }
        case 'docx':
        default: {
          return this.docxGenerator.generateDocx(category, selectedVariant, criteria);
        }
      }
    }

    throw new BadRequestException(
      `Specification generation has failed for category with id ${this.categoryId}. Enter new data or try again.`
    );
  }

  private async getDirectoryTable(id: string): Promise<string[][]> {
    return csv.parse(await this.documents.getTable('directory', id));
  }

  private async getFormulasTable(id: string): Promise<string[][]> {
    return csv.parse(await this.documents.getTable('formulas', id));
  }
}
