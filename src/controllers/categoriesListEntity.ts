import { CategoriesListEntityModel } from 'models';

import { CategoriesListEntity } from 'types/transport';

const add = async (categoryId: string, version: string): Promise<void> => {
  const categoriesListEntityForSaving = { _id: categoryId, version };

  await new CategoriesListEntityModel(categoriesListEntityForSaving).save();
};

const getAll = async (): Promise<CategoriesListEntity[]> => {
  return await CategoriesListEntityModel.find({}).then(categoryListEntities =>
    categoryListEntities
      .sort((a, b) => +b.updatedAt - +a.updatedAt)
      .map(({ _id, version }) => ({
        id: _id,
        version: version,
      }))
  );
};

const updateOne = async (categoryId: string, version: string): Promise<void> => {
  await CategoriesListEntityModel.findOneAndUpdate({ _id: categoryId }, { _id: categoryId, version });
};

export default { add, updateOne, getAll };
