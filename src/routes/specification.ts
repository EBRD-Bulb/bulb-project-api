import fastify from 'fastify';

export const specificationRoute = (app: fastify.FastifyInstance): void => {
  app.get('/specification/:categoryId/:version', async req => {
    return `Specification for specific good from category chosen for:
         categoryId ${req.params.categoryId},
         version ${req.params.version},
         And query params:
         egp ${req.query.egp},
         mode ${req.query.mode}
         `;
  });

  app.get('/specification/:categoryId/:version/:calculationId/:variantId', async req => {
    return `Specification for specific good from category chosen for:
         categoryId ${req.params.categoryId},
         version ${req.params.version},
         calculationId ${req.params.calculationId},
         variantId ${req.params.variantId}.
         And query params:
         egp ${req.query.egp},
         mode ${req.query.mode}
         `;
  });
};
