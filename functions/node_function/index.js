/**
 * 
 * @param {import('./types/basicio').Context} context 
 * @param {import('./types/basicio').BasicIO} basicIO 
 */
module.exports = (context, basicIO) => {
	/* 
        BASICIO FUNCTIONALITIES
    */
	basicIO.write('Hello from index.js'); //response stream (accepts only string, throws error if other than string)
	basicIO.getArgument('argument1'); // returns QUERY_PARAM[argument1] || BODY_JSON[argument1] (takes argument from query and body, first preference to query)
	/* 
        CONTEXT FUNCTIONALITIES
    */
	console.log('successfully executed basicio functions');
	context.close(); //end of application
};
