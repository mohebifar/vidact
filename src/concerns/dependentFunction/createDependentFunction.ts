import ts from "typescript";
import { DependentFunctionDescriptor } from "./types";

export function createDependentFunction(descriptor: DependentFunctionDescriptor) {

    const body : ts.Statement[] = []
    const block = ts.factory.createBlock(body)
    ts.factory.createFunctionDeclaration(undefined, undefined, undefined, descriptor.name, undefined, [], undefined, block)

    descriptor.statements?.map(statement => {
        
    })

    
}